import time
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from backend.accounts.database import database
from backend.accounts.security import check_origin, limit
from backend.usage.access import require_admin, is_admin
from .pages import admin_page
from backend.maintenance.backup import status as backup_status

router = APIRouter()


@router.get('/admin')
@router.get('/admin/users')
@router.get('/admin/audit')
def page(request: Request):
    active = {'/admin':'overview','/admin/users':'users','/admin/audit':'audit'}[request.url.path]
    return admin_page(request, 'admin-workspace.html', active)


@router.get('/api/admin/overview')
def overview(user=Depends(require_admin)):
    now = int(time.time())
    with database() as db:
        users = dict(db.execute('''SELECT COUNT(*) AS total,
          COALESCE(SUM(verified),0) AS verified,
          COALESCE(SUM(CASE WHEN created>=? THEN 1 ELSE 0 END),0) AS new_week FROM users''', (now-7*86400,)).fetchone())
        users['suspended'] = db.execute('SELECT COUNT(*) FROM account_suspensions').fetchone()[0]
        users['signed_in'] = db.execute('''SELECT COUNT(DISTINCT l.user_id) FROM logins l
          JOIN users u ON u.id=l.user_id WHERE l.expires>? AND u.verified=1
          AND NOT EXISTS (SELECT 1 FROM account_suspensions s WHERE s.user_id=l.user_id)''', (now,)).fetchone()[0]
        sessions = dict(db.execute('SELECT COUNT(*) AS saved,COALESCE(SUM(bytes),0) AS bytes FROM interviews').fetchone())
        recent = [dict(row) for row in db.execute('SELECT id,name,email,created,verified FROM users ORDER BY created DESC,id LIMIT 5')]
    return {'users':users,'sessions':sessions,'recent_users':recent,'at':now,'backup':backup_status()}


@router.get('/api/admin/users')
def users(q: str = Query('',max_length=100), status: Literal['all','verified','unverified','suspended']='all',
          page: int = Query(1,ge=1,le=100000), user=Depends(require_admin)):
    # instr provides literal search: '%' and '_' are not wildcards.
    query=q.strip().lower()
    where="(strpos(lower(u.email),?)>0 OR strpos(lower(u.name),?)>0)"
    if status=='suspended': where+=' AND s.user_id IS NOT NULL'
    elif status=='verified': where+=' AND u.verified=1 AND s.user_id IS NULL'
    elif status=='unverified': where+=' AND u.verified=0 AND s.user_id IS NULL'
    with database() as db:
        total=db.execute('SELECT COUNT(*) FROM users u LEFT JOIN account_suspensions s ON s.user_id=u.id WHERE '+where,(query,query)).fetchone()[0]
        rows=[dict(r) for r in db.execute('''SELECT u.id,u.name,u.email,u.verified,u.created,
          CASE WHEN s.user_id IS NULL THEN 0 ELSE 1 END AS suspended,
          (SELECT COUNT(*) FROM interviews i WHERE i.user_id=u.id) AS sessions
          FROM users u LEFT JOIN account_suspensions s ON s.user_id=u.id WHERE '''+where+
          ' ORDER BY u.created DESC,u.id LIMIT 20 OFFSET ?', (query,query,(page-1)*20))]
    for row in rows:
        row['protected']=row['id']==user['id'] or is_admin(row)
    return {'users':rows,'total':total,'page':page,'page_size':20}


class AccessChange(BaseModel):
    action: Literal['suspend','restore']
    reason: str = Field(min_length=3,max_length=300)


@router.post('/api/admin/users/{uid}/access',dependencies=[Depends(check_origin)])
def access(uid: str, change: AccessChange, user=Depends(require_admin)):
    reason=change.reason.strip()
    if len(reason)<3: raise HTTPException(422,'Enter a reason of at least three characters.')
    limit('admin-access:'+user['id'],30,60)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        target=db.execute('SELECT id,email FROM users WHERE id=?',(uid,)).fetchone()
        if not target: raise HTTPException(404,'Account not found.')
        if uid==user['id'] or is_admin(dict(target)):
            raise HTTPException(403,'Administrator accounts cannot be changed here.')
        suspended=db.execute('SELECT 1 FROM account_suspensions WHERE user_id=?',(uid,)).fetchone() is not None
        if suspended==(change.action=='suspend'):
            raise HTTPException(409,'Account access has already changed. Refresh the list.')
        if change.action=='suspend':
            db.execute('INSERT INTO account_suspensions VALUES (?,?)',(uid,int(time.time())))
            db.execute('DELETE FROM logins WHERE user_id=?',(uid,))
            db.execute('DELETE FROM links WHERE user_id=?',(uid,))
        else:
            db.execute('DELETE FROM account_suspensions WHERE user_id=?',(uid,))
        db.execute('INSERT INTO admin_audit (at,actor_id,target_id,action,reason) VALUES (?,?,?,?,?)',
                   (int(time.time()),user['id'],uid,change.action,reason))
    return {'changed':True,'action':change.action}


@router.get('/api/admin/audit')
def audit(page: int=Query(1,ge=1,le=100000),user=Depends(require_admin)):
    with database() as db:
        total=db.execute('SELECT COUNT(*) FROM admin_audit').fetchone()[0]
        rows=[dict(r) for r in db.execute('SELECT id,at,actor_id,target_id,action,reason FROM admin_audit ORDER BY id DESC LIMIT 20 OFFSET ?',((page-1)*20,))]
    return {'events':rows,'total':total,'page':page,'page_size':20}
