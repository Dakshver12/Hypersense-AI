"""Owned, immutable recording references and durable object-deletion receipts."""
import json
import re
import time
from uuid import uuid4
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from .database import database
from .security import require_user, require_practice_user, check_origin, limit
from .object_storage import ObjectStorage, configured, mime_type, MAX_RECORDING_BYTES

router = APIRouter(prefix='/api/account/recordings')
MAX_ACCOUNT_BYTES = 100 * 1024 * 1024
UPLOAD_LIFETIME = 2 * 3600 + 300  # Includes clock/transfer grace after signed token expiry.


class Upload(BaseModel):
    session_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    name: str = Field(default='answer.webm', max_length=150)
    type: str = Field(default='application/octet-stream', max_length=100)
    bytes: int = Field(gt=0, le=MAX_RECORDING_BYTES, strict=True)


def reference(row):
    return {'object_id': row['id'], 'name': row['name'], 'type': row['mime'], 'bytes': row['bytes']}


def owned(db, uid, ident):
    if not re.fullmatch(r'[a-f0-9]{32}', ident):
        raise HTTPException(404, 'Recording not found.')
    row = db.execute('SELECT * FROM recording_objects WHERE id=? AND user_id=?', (ident, uid)).fetchone()
    if not row or row['status'] == 'deleting':
        raise HTTPException(404, 'Recording not found.')
    return row


def storage_usage(db, uid):
    # Pending uploads reserve the bucket maximum. Verified objects cannot be
    # overwritten (upload tokens have upsert disabled), so count their real size.
    # Deleted objects reserve the maximum until the upload token expires.
    now = int(time.time())
    return db.execute("SELECT COALESCE(SUM(CASE WHEN status!='ready' AND expires>? THEN ? ELSE bytes END),0) "
                      'FROM recording_objects WHERE user_id=?',
                      (now, MAX_RECORDING_BYTES, uid)).fetchone()[0]


def bind_references(db, uid, session_id, record):
    ids = set()
    for answer in record['answers']:
        rec = answer.get('recording')
        if not rec or 'object_id' not in rec:
            continue
        row = owned(db, uid, rec['object_id'])
        if row['status'] != 'ready' or row['session_id'] != session_id:
            raise HTTPException(422, 'Recording is not ready for this session. Retry saving.')
        answer['recording'] = reference(row)
        ids.add(row['id'])
    rows = db.execute('SELECT id FROM recording_objects WHERE user_id=? AND session_id=? AND status=?',
                      (uid, session_id, 'ready')).fetchall()
    for row in rows:
        if row['id'] not in ids:
            db.execute('UPDATE recording_objects SET status=? WHERE id=?', ('deleting', row['id']))


def mark_deleted(db, uid, session_id=None):
    sql = 'UPDATE recording_objects SET status=? WHERE user_id=?'
    params = ('deleting', uid)
    if session_id is not None:
        sql += ' AND session_id=?'
        params += (session_id,)
    db.execute(sql, params)


def cleanup(uid=None, maximum=100):
    """Retryable cleanup. No user data or credentials are returned/logged.

    Keep tombstones until upload tokens expire so replay cannot leave an orphan.
    Abandoned uploads expire after one day. Missing users are collected too.
    """
    now = int(time.time())
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        rows = db.execute('SELECT * FROM recording_objects' + (' WHERE user_id=?' if uid else ''),
                          (uid,) if uid else ()).fetchall()
        targets = []
        for row in rows:
            if len(targets) >= maximum:
                break
            remove = row['status'] == 'deleting'
            if not remove and (row['created'] < now - 86400 or not db.execute(
                    'SELECT id FROM users WHERE id=?', (row['user_id'],)).fetchone()):
                session = db.execute('SELECT payload FROM interviews WHERE user_id=? AND id=?',
                                     (row['user_id'], row['session_id'])).fetchone()
                ids = {a.get('recording', {}).get('object_id') for a in json.loads(session['payload'])['answers']
                       if isinstance(a.get('recording'), dict)} if session else set()
                remove = row['id'] not in ids
            if remove:
                db.execute('UPDATE recording_objects SET status=? WHERE id=?', ('deleting', row['id']))
                targets.append(dict(row))
    result = {'deleted': 0, 'deferred': 0, 'failed': 0}
    for row in targets:
        try:
            storage = ObjectStorage()
            # Refuse to operate on a different bucket/project after env changes.
            if row['storage_origin'] != storage.origin or row['bucket'] != storage.bucket:
                raise HTTPException(503, 'Recording belongs to a different storage configuration.')
            storage.remove(row['object_key'])
            if now >= row['expires']:
                with database() as db:
                    db.execute('DELETE FROM recording_objects WHERE id=? AND status=?', (row['id'], 'deleting'))
                result['deleted'] += 1
            else:
                result['deferred'] += 1
        except HTTPException:
            result['failed'] += 1
    return result


def storage_for(row):
    storage = ObjectStorage()
    if row['storage_origin'] != storage.origin or row['bucket'] != storage.bucket:
        raise HTTPException(503, 'This recording belongs to a different storage configuration.')
    return storage


@router.get('/config')
def config(user=Depends(require_user)):
    if not configured():
        return {'enabled': False}
    ObjectStorage().check_bucket()
    return {'enabled': True, 'max_bytes': MAX_RECORDING_BYTES}


@router.post('/uploads', dependencies=[Depends(check_origin)])
def start_upload(data: Upload, user=Depends(require_user)):
    limit('recording-upload:' + user['id'], 30, 3600)
    mime = mime_type(data.type)
    storage = ObjectStorage()
    storage.check_bucket()
    ident, now = uuid4().hex, int(time.time())
    key = user['id'] + '/' + data.session_id + '/' + ident
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        documents = db.execute('SELECT COALESCE(SUM(bytes),0) FROM interviews WHERE user_id=?', (user['id'],)).fetchone()[0]
        if documents + storage_usage(db, user['id']) + MAX_RECORDING_BYTES > MAX_ACCOUNT_BYTES:
            raise HTTPException(413, 'Account recording storage is full. Remove older sessions, or retry after pending uploads expire.')
        db.execute('INSERT INTO recording_objects '
                   '(id,user_id,session_id,object_key,storage_origin,bucket,name,mime,bytes,status,created,expires) '
                   'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                   (ident,user['id'],data.session_id,key,storage.origin,storage.bucket,data.name,mime,data.bytes,
                    'pending',now,now+UPLOAD_LIFETIME))
    try:
        url = storage.upload_url(key)
    except HTTPException:
        with database() as db:
            db.execute('UPDATE recording_objects SET status=? WHERE id=?', ('deleting', ident))
        raise
    return {'object_id': ident, 'upload_url': url}


@router.post('/{ident}/complete', dependencies=[Depends(check_origin)])
def complete_upload(ident: str, user=Depends(require_user)):
    limit('recording-complete:' + user['id'], 120, 3600)
    with database(readonly=True) as db:
        row = dict(owned(db, user['id'], ident))
    if row['status'] == 'ready':
        return reference(row)
    size, mime = storage_for(row).info(row['object_key'])
    if size != row['bytes'] or not 0 < size <= MAX_RECORDING_BYTES or mime != row['mime']:
        with database() as db:
            db.execute('UPDATE recording_objects SET status=? WHERE id=?', ('deleting', ident))
        raise HTTPException(422, 'Uploaded recording does not match its declared size or format. Record again or choose another file.')
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        owned(db, user['id'], ident)  # Recheck after network I/O; deletion wins.
        db.execute('UPDATE recording_objects SET status=? WHERE id=?', ('ready', ident))
    return reference(row)


@router.get('/{ident}/playback')
def playback(ident: str, user=Depends(require_user)):
    with database(readonly=True) as db:
        row = dict(owned(db, user['id'], ident))
        if row['status'] != 'ready':
            raise HTTPException(409, 'Recording upload is not complete.')
    return {'url': storage_for(row).playback_url(row['object_key']), 'expires_in': 300}


class TranscriptionRequest(BaseModel):
    spoken_language: Literal['auto', 'en', 'hi'] = 'auto'


@router.post('/{ident}/transcribe', dependencies=[Depends(check_origin)])
def transcribe_recording(ident: str, data: TranscriptionRequest, user=Depends(require_practice_user)):
    from io import BytesIO
    from pathlib import Path
    from fastapi import UploadFile
    from backend.services.transcription import transcribe_audio

    limit('recording-transcribe:' + user['id'], 60, 3600)
    with database(readonly=True) as db:
        row = dict(owned(db, user['id'], ident))
    if row['status'] != 'ready':
        raise HTTPException(409, 'Recording upload is not complete.')
    if Path(row['name']).suffix.lower() not in {'.wav', '.mp3', '.m4a', '.webm', '.ogg', '.flac'}:
        raise HTTPException(400, 'Upload a WAV, MP3, M4A, WebM, OGG, or FLAC file.')
    audio = storage_for(row).download(row['object_key'], row['bytes'])
    source = UploadFile(filename=row['name'], file=BytesIO(audio))
    try:
        return transcribe_audio(source, data.spoken_language)
    finally:
        source.file.close()
