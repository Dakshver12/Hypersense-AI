"""Private interview documents with cloud references and legacy base64 support."""
import base64
import binascii
import json
import re
import time
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from .database import database
from .security import require_user, check_origin, limit
from .recordings import bind_references, mark_deleted, storage_usage, cleanup
from .object_storage import configured

router = APIRouter(prefix='/api/account/sessions')
MAX_ACCOUNT_BYTES = 100 * 1024 * 1024
MAX_SESSION_BYTES = 24 * 1024 * 1024
MAX_DRAFT_BYTES = 5 * 1024 * 1024


def valid_id(value):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',value):
        raise HTTPException(422,'Invalid session ID.')


def validate(record, active=False):
    if not isinstance(record,dict) or not isinstance(record.get('id'),str):
        raise HTTPException(422,'Invalid session document.')
    valid_id(record['id'])
    answers = record.get('answers')
    if not isinstance(answers,list) or len(answers)>100 or not isinstance(record.get('settings'),dict):
        raise HTTPException(422,'Invalid session answers or settings.')
    if type(record.get('total')) is not int or not 1 <= record['total'] <= 100 or len(answers)>record['total']:
        raise HTTPException(422,'Invalid question count.')
    if not isinstance(record.get('date'),str) or len(record['date'])>80:
        raise HTTPException(422,'Invalid date.')
    # Private uploaded resumes are not copied into finished interview history.
    record['settings'].pop('resume_text',None)
    record['active'] = bool(active)
    record['loaded'] = False
    if active:
        if not isinstance(record.get('questions'), list) or len(record['questions']) > 100:
            raise HTTPException(422, 'Invalid draft questions.')
        for question in record['questions']:
            if not isinstance(question, str) or not question.strip() or len(question) > 2000:
                raise HTTPException(422, 'Invalid draft question.')
        pending = record.get('pendingQuestion')
        if pending is not None and (not isinstance(pending, dict) or
                                    not isinstance(pending.get('question'), str) or
                                    not pending['question'].strip() or len(pending['question']) > 2000):
            raise HTTPException(422, 'Invalid pending draft question.')
    for answer in answers:
        if not isinstance(answer,dict) or not isinstance(answer.get('question'),str):
            raise HTTPException(422,'Invalid answer.')
        if len(answer['question'])>10000 or not isinstance(answer.get('answer',''),str) or len(answer.get('answer',''))>32000:
            raise HTTPException(422,'Answer text is too long.')
        recording = answer.get('recording')
        if recording is not None:
            if isinstance(recording,dict) and 'object_id' in recording:
                if not isinstance(recording['object_id'],str) or not re.fullmatch(r'[a-f0-9]{32}',recording['object_id']):
                    raise HTTPException(422,'Invalid recording reference.')
                answer['recording'] = {key:recording[key] for key in ('object_id','name','type','bytes') if key in recording}
                continue
            if not isinstance(recording,dict) or not isinstance(recording.get('base64'),str):
                raise HTTPException(422,'Invalid recording.')
            try:
                raw = base64.b64decode(recording['base64'],validate=True)
            except (ValueError,binascii.Error):
                raise HTTPException(422,'Invalid recording encoding.') from None
            if not raw or len(raw)>10*1024*1024:
                raise HTTPException(413,'Each recording must be between 1 byte and 10 MB.')
            answer['recording'] = {'base64':recording['base64'], 'type':str(recording.get('type','application/octet-stream'))[:100],
                                   'name':str(recording.get('name','answer.webm'))[:150], 'bytes':len(raw)}
    try:
        payload = json.dumps(record,ensure_ascii=False,allow_nan=False)
    except (ValueError,TypeError):
        raise HTTPException(422,'Invalid session data.') from None
    size = len(payload.encode())
    if size>MAX_SESSION_BYTES:
        raise HTTPException(413,'This session exceeds the 24 MB account limit. Export a local backup instead.')
    return payload,size


def validate_draft(record):
    payload, size = validate(record, active=True)
    if size > MAX_DRAFT_BYTES:
        raise HTTPException(413, 'This unfinished interview draft is too large.')
    return payload, size


@router.get('')
def list_sessions(user=Depends(require_user)):
    with database(readonly=True) as db:
        rows=db.execute('SELECT payload FROM interviews WHERE user_id=?',(user['id'],)).fetchall()
    return [json.loads(row['payload']) for row in rows]


@router.get('/draft')
def get_draft(user=Depends(require_user)):
    with database(readonly=True) as db:
        row = db.execute('SELECT payload FROM interview_drafts WHERE user_id=?', (user['id'],)).fetchone()
    if not row:
        raise HTTPException(404, 'No unfinished interview draft was found.')
    return json.loads(row['payload'])


@router.put('/draft', dependencies=[Depends(check_origin)])
def put_draft(record: dict, user=Depends(require_user)):
    if not isinstance(record, dict) or record.get('active') is not True:
        raise HTTPException(422, 'Only an active interview draft can be saved.')
    limit('draft-save:' + user['id'], 120, 60)
    payload, size = validate_draft(record)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('INSERT INTO interview_drafts (user_id,payload,bytes,updated) VALUES (?,?,?,?) '
                   'ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,bytes=excluded.bytes,updated=excluded.updated',
                   (user['id'], payload, size, int(time.time())))
    return {'saved': True}


@router.delete('/draft', dependencies=[Depends(check_origin)])
def delete_draft(user=Depends(require_user)):
    with database() as db:
        db.execute('DELETE FROM interview_drafts WHERE user_id=?', (user['id'],))
    return {'deleted': True}


@router.get('/{session_id}')
def get_session(session_id: str,user=Depends(require_user)):
    valid_id(session_id)
    with database(readonly=True) as db:
        row=db.execute('SELECT payload FROM interviews WHERE user_id=? AND id=?',(user['id'],session_id)).fetchone()
    if not row:
        raise HTTPException(404,'Session not found.')
    return json.loads(row['payload'])


@router.put('/{session_id}',dependencies=[Depends(check_origin)])
def put_session(session_id: str,record: dict,request: Request,background_tasks: BackgroundTasks,user=Depends(require_user)):
    valid_id(session_id)
    if record.get('id')!=session_id:
        raise HTTPException(422,'Session ID mismatch.')
    limit('save:'+user['id'],60,60)
    validate(record)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        bind_references(db,user['id'],session_id,record)
        payload,size=validate(record)
        if configured() and size>1024*1024 and not any(isinstance(a.get('recording'),dict) and 'base64' in a['recording'] for a in record['answers']):
            raise HTTPException(413,'Session text exceeds the 1 MB cloud document limit.')
        old=db.execute('SELECT bytes FROM interviews WHERE user_id=? AND id=?',(user['id'],session_id)).fetchone()
        if old and request.headers.get('if-none-match')=='*':
            raise HTTPException(409,'This session already exists.')
        usage=db.execute('SELECT COUNT(*), COALESCE(SUM(bytes),0) FROM interviews WHERE user_id=?',(user['id'],)).fetchone()
        if (not old and usage[0]>=100) or usage[1]-(old['bytes'] if old else 0)+size+storage_usage(db,user['id'])>MAX_ACCOUNT_BYTES:
            raise HTTPException(413,'Account storage limit reached (100 sessions / 100 MB). Export and remove older sessions.')
        db.execute('INSERT INTO interviews VALUES (?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload,bytes=excluded.bytes',
                   (user['id'],session_id,payload,size))
    background_tasks.add_task(cleanup,user['id'])
    return {'id':session_id}


@router.delete('/{session_id}',dependencies=[Depends(check_origin)])
def delete_session(session_id: str,background_tasks: BackgroundTasks,user=Depends(require_user)):
    valid_id(session_id)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        mark_deleted(db,user['id'],session_id)
        db.execute('DELETE FROM interviews WHERE user_id=? AND id=?',(user['id'],session_id))
    background_tasks.add_task(cleanup,user['id'])
    return {'deleted':True}
