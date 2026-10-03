import time
from html import escape
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field, field_validator
from backend.accounts.database import database
from backend.accounts.security import current_user, require_user, check_origin, limit
from backend.admin.pages import admin_page
from backend.usage.access import require_admin
from backend.config import PROJECT_ROOT

router=APIRouter()
Status=Literal['open','in_progress','resolved']


class NewReport(BaseModel):
    request_id: UUID
    category: Literal['bug','question','feedback']
    title: str = Field(min_length=3,max_length=120)
    description: str = Field(min_length=10,max_length=3000)

    @field_validator('title','description')
    @classmethod
    def trim(cls,value):
        value=value.strip()
        if not value: raise ValueError('Enter report details.')
        return value


class ReadReply(BaseModel):
    reply_version: int = Field(ge=0)


class ThreadMessage(BaseModel):
    request_id: UUID
    body: str = Field(min_length=1,max_length=2000)
    version: int = Field(ge=1)
    status: Status | None = None
    reopen: bool = False


class UpdateReport(BaseModel):
    status: Status
    reply: str = Field(default='',max_length=2000)
    version: int = Field(ge=1)


@router.get('/support')
def support_page(request: Request):
    user=current_user(request)
    if not user: return RedirectResponse('/login',status_code=303)
    html=(PROJECT_ROOT/'templates/support.html').read_text(encoding='utf-8')
    return HTMLResponse(html.replace('<!-- account-id -->',escape(user['id'],quote=True)),headers={'Cache-Control':'no-store'})


@router.get('/admin/support')
def admin_support_page(request: Request):
    return admin_page(request,'admin-support.html','support')


@router.post('/api/support',dependencies=[Depends(check_origin)])
def create_report(data: NewReport,user=Depends(require_user)):
    if len(data.title)<3 or len(data.description)<10: raise HTTPException(422,'Add a title and at least ten characters of detail.')
    rid=str(data.request_id)
    with database() as db:
        existing=db.execute('SELECT id FROM support_reports WHERE id=? AND user_id=?',(rid,user['id'])).fetchone()
        if existing: return {'id':rid,'created':False}
    limit('support-new:'+user['id'],10,86400)
    now=int(time.time())
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        existing=db.execute('SELECT user_id FROM support_reports WHERE id=?',(rid,)).fetchone()
        if existing:
            if existing['user_id']==user['id']: return {'id':rid,'created':False}
            raise HTTPException(409,'Please retry with a new report.')
        if db.execute('SELECT COUNT(*) FROM support_reports WHERE user_id=?',(user['id'],)).fetchone()[0]>=100:
            raise HTTPException(429,'You have reached the saved-report limit. Please use an existing report.')
        db.execute('INSERT INTO support_reports VALUES (?,?,?,?,?,?,?,?,?,?)',
          (rid,user['id'],data.category,data.title,data.description,'open','',now,now,1))
        db.execute('INSERT INTO support_receipts VALUES (?,0,0)',(rid,))
        db.execute("INSERT INTO support_threads VALUES (?,1,'user')",(rid,))
    return {'id':rid,'created':True}


def report_detail(rid,user,admin=False):
    with database() as db:
        db.execute('BEGIN')
        query="SELECT r.id,r.category,r.title,r.description,r.status,r.reply,r.created,r.updated,r.version,coalesce(n.reply_version,0) reply_version,(r.reply!='' AND coalesce(n.reply_version,0)>coalesce(n.read_version,0)) unread FROM support_reports r LEFT JOIN support_receipts n ON n.report_id=r.id WHERE r.id=?"
        row=db.execute(query+('' if admin else ' AND r.user_id=?'),(rid,) if admin else (rid,user['id'])).fetchone()
        if not row: raise HTTPException(404,'Report not found.')
        result=dict(row)
        result['messages']=[dict(m) for m in db.execute('SELECT id,role,body,created,version FROM support_messages WHERE report_id=? ORDER BY version',(rid,))]
        thread=db.execute('SELECT user_version FROM support_threads WHERE report_id=?',(rid,)).fetchone()
        result['user_version']=thread['user_version'] if thread else 1
        if admin:
            receipt=db.execute('SELECT read_version FROM support_admin_reads WHERE report_id=? AND admin_id=?',(rid,user['id'])).fetchone()
            result['unread']=result['user_version']>(receipt['read_version'] if receipt else 0)
    return result


@router.get('/api/support')
def own_reports(page: int=Query(1,ge=1,le=100000),user=Depends(require_user)):
    with database() as db:
        total=db.execute('SELECT COUNT(*) FROM support_reports WHERE user_id=?',(user['id'],)).fetchone()[0]
        rows=[dict(r) for r in db.execute("SELECT r.id,r.category,r.title,r.status,r.created,r.updated,(r.reply!='' AND coalesce(n.reply_version,0)>coalesce(n.read_version,0)) unread FROM support_reports r LEFT JOIN support_receipts n ON n.report_id=r.id WHERE r.user_id=? ORDER BY r.updated DESC,r.id LIMIT 20 OFFSET ?", (user['id'],(page-1)*20))]
    return {'reports':rows,'total':total,'page':page}


@router.get('/api/support/unread')
def unread_replies(user=Depends(require_user)):
    with database() as db:
        count=db.execute("SELECT COUNT(*) FROM support_reports r JOIN support_receipts n ON n.report_id=r.id WHERE r.user_id=? AND r.reply!='' AND n.reply_version>n.read_version",(user['id'],)).fetchone()[0]
    return {'unread':count}


@router.post('/api/support/{rid}/read',dependencies=[Depends(check_origin)])
def read_reply(rid: UUID,data: ReadReply,user=Depends(require_user)):
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT id FROM support_reports WHERE id=? AND user_id=?',(str(rid),user['id'])).fetchone()
        if not row: raise HTTPException(404,'Report not found.')
        # Acknowledge only the revision actually displayed, not a newer concurrent reply.
        db.execute('UPDATE support_receipts SET read_version=greatest(read_version,least(reply_version,?)) WHERE report_id=?',(data.reply_version,str(rid)))
    return {'read':True}


@router.get('/api/support/{rid}')
def own_report(rid: UUID,user=Depends(require_user)):
    return report_detail(str(rid),user)


@router.get('/api/admin/support')
def all_reports(status: Literal['all','open','in_progress','resolved']='all',q: str=Query('',max_length=100),page: int=Query(1,ge=1,le=100000),user=Depends(require_admin)):
    where='(strpos(lower(r.title),?)>0 OR strpos(lower(u.email),?)>0)'
    params=[q.strip().lower()]*2
    if status!='all': where+=' AND r.status=?';params.append(status)
    with database() as db:
        awaiting_reply=db.execute("SELECT COUNT(*) FROM support_reports r JOIN support_threads t ON t.report_id=r.id WHERE r.status!='resolved' AND t.last_role='user'").fetchone()[0]
        counts={r['status']:r['n'] for r in db.execute('SELECT status,COUNT(*) n FROM support_reports GROUP BY status')}
        total=db.execute('SELECT COUNT(*) FROM support_reports r JOIN users u ON u.id=r.user_id WHERE '+where,params).fetchone()[0]
        rows=[dict(r) for r in db.execute("SELECT r.id,r.category,r.title,r.status,r.created,r.updated,u.email,(r.status!='resolved' AND t.last_role='user') awaiting_reply,(t.user_version>coalesce(ar.read_version,0)) admin_unread FROM support_reports r JOIN users u ON u.id=r.user_id JOIN support_threads t ON t.report_id=r.id LEFT JOIN support_admin_reads ar ON ar.report_id=r.id AND ar.admin_id=? WHERE "+where+' ORDER BY r.updated DESC,r.id LIMIT 20 OFFSET ?',[user['id'],*params,(page-1)*20])]
    return {'reports':rows,'total':total,'page':page,'counts':counts,'awaiting_reply':awaiting_reply}


@router.get('/api/admin/support/{rid}')
def admin_report(rid: UUID,user=Depends(require_admin)):
    return report_detail(str(rid),user,True)


@router.patch('/api/admin/support/{rid}',dependencies=[Depends(check_origin)])
def update_report(rid: UUID,data: UpdateReport,user=Depends(require_admin)):
    limit('support-update:'+user['id'],60,60)
    reply=data.reply.strip()
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT status,version,reply FROM support_reports WHERE id=?',(str(rid),)).fetchone()
        if not row: raise HTTPException(404,'Report not found.')
        if data.status=='resolved' and not reply and not row['reply']: raise HTTPException(422,'Add a reply explaining the resolution.')
        if row['version']!=data.version: raise HTTPException(409,'Another administrator updated this report. Close and reopen it before saving.')
        db.execute('UPDATE support_reports SET status=?,reply=?,updated=?,version=version+1 WHERE id=?',(data.status,reply or row['reply'],int(time.time()),str(rid)))
        if reply and reply!=row['reply']:
            if db.execute('SELECT COUNT(*) FROM support_messages WHERE report_id=?',(str(rid),)).fetchone()[0]>=200: raise HTTPException(409,'This conversation has reached its message limit. Create a new report.')
            db.execute('INSERT INTO support_messages VALUES (?,?,?,?,?,?,?)',('update-'+str(rid)+'-'+str(row['version']+1),str(rid),user['id'],'admin',reply,int(time.time()),row['version']+1))
            db.execute("UPDATE support_threads SET last_role='admin' WHERE report_id=?",(str(rid),))
            db.execute('INSERT INTO support_receipts(report_id,reply_version,read_version) VALUES (?,?,0) ON CONFLICT(report_id) DO UPDATE SET reply_version=excluded.reply_version',(str(rid),row['version']+1))
        db.execute('INSERT INTO admin_audit (at,actor_id,target_id,action,reason) VALUES (?,?,?,?,?)',(int(time.time()),user['id'],str(rid),'support_update','Report status: '+row['status']+' → '+data.status))
    return {'updated':True}


@router.post('/api/admin/support/{rid}/read',dependencies=[Depends(check_origin)])
def admin_read(rid: UUID,data: ReadReply,user=Depends(require_admin)):
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT user_version FROM support_threads WHERE report_id=?',(str(rid),)).fetchone()
        if not row: raise HTTPException(404,'Report not found.')
        boundary=min(row['user_version'],data.reply_version)
        db.execute('INSERT INTO support_admin_reads VALUES (?,?,?) ON CONFLICT(report_id,admin_id) DO UPDATE SET read_version=greatest(support_admin_reads.read_version,excluded.read_version)',(str(rid),user['id'],boundary))
    return {'read':True}


def append_message(rid,data,user,admin=False):
    rid=str(rid);mid=str(data.request_id);body=data.body.strip()
    if not body: raise HTTPException(422,'Enter a message before sending.')
    if not admin and data.status is not None: raise HTTPException(422,'Only support can set a report status.')
    role='admin' if admin else 'user'
    with database() as db:
        existing=db.execute('SELECT report_id,author_id,role FROM support_messages WHERE id=?',(mid,)).fetchone()
        if existing:
            if tuple(existing)==(rid,user['id'],role): return {'sent':True}
            raise HTTPException(409,'Message request ID already used.')
    limit('support-message:'+user['id'],60 if admin else 30,3600)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT * FROM support_reports WHERE id=?'+('' if admin else ' AND user_id=?'),(rid,) if admin else (rid,user['id'])).fetchone()
        if not row: raise HTTPException(404,'Report not found.')
        existing=db.execute('SELECT report_id,author_id,role FROM support_messages WHERE id=?',(mid,)).fetchone()
        if existing:
            if tuple(existing)==(rid,user['id'],role): return {'sent':True}
            raise HTTPException(409,'Message request ID already used.')
        if row['version']!=data.version: raise HTTPException(409,'This conversation has changed. Refresh the conversation, then send again. Your draft is kept.')
        if not admin and row['status']=='resolved' and not data.reopen: raise HTTPException(409,'Reopen this report to send a follow-up.')
        if db.execute('SELECT COUNT(*) FROM support_messages WHERE report_id=?',(rid,)).fetchone()[0]>=200: raise HTTPException(409,'This conversation has reached its message limit. Create a new report.')
        version=row['version']+1;now=int(time.time())
        next_status=(data.status or row['status']) if admin else ('open' if row['status']=='resolved' else row['status'])
        db.execute('INSERT INTO support_messages VALUES (?,?,?,?,?,?,?)',(mid,rid,user['id'],role,body,now,version))
        db.execute('UPDATE support_reports SET status=?,reply=?,updated=?,version=? WHERE id=?',(next_status,body if admin else row['reply'],now,version,rid))
        if admin:
            db.execute("UPDATE support_threads SET last_role='admin' WHERE report_id=?",(rid,))
            db.execute('INSERT INTO support_receipts VALUES (?,?,0) ON CONFLICT(report_id) DO UPDATE SET reply_version=excluded.reply_version',(rid,version))
            db.execute('INSERT INTO admin_audit(at,actor_id,target_id,action,reason) VALUES (?,?,?,?,?)',(now,user['id'],rid,'support_update','Support reply added; status: '+next_status))
        else:
            db.execute("UPDATE support_threads SET user_version=?,last_role='user' WHERE report_id=?",(version,rid))
    return {'sent':True}


@router.post('/api/support/{rid}/messages',dependencies=[Depends(check_origin)])
def user_message(rid: UUID,data: ThreadMessage,user=Depends(require_user)):
    return append_message(rid,data,user)


@router.post('/api/admin/support/{rid}/messages',dependencies=[Depends(check_origin)])
def admin_message(rid: UUID,data: ThreadMessage,user=Depends(require_admin)):
    return append_message(rid,data,user,True)
