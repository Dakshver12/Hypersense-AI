"""Bound request sizes before JSON/multipart parsing and keep private responses uncached."""
from starlette.responses import JSONResponse


class AccountSafetyMiddleware:
    def __init__(self,app):
        self.app=app

    async def __call__(self,scope,receive,send):
        if scope['type']!='http':
            return await self.app(scope,receive,send)
        path=scope['path']
        private=not path.startswith('/static/')
        async def safe_send(message):
            if message['type']=='http.response.start':
                headers=[(k,v) for k,v in message.get('headers',[]) if not (private and k.lower()==b'cache-control')]
                if private:
                    headers.append((b'cache-control',b'no-store'))
                headers.extend([(b'x-content-type-options',b'nosniff'),(b'x-frame-options',b'DENY'),(b'referrer-policy',b'no-referrer')])
                message={**message,'headers':headers}
            await send(message)
        if scope['method'] not in ('POST','PUT','PATCH'):
            return await self.app(scope,receive,safe_send)
        cap=32*1024*1024 if path.startswith('/api/account/sessions') else 12*1024*1024 if path=='/transcribe' else 2*1024*1024 if path=='/detect-face' else 64*1024
        chunks=[]
        size=0
        while True:
            message=await receive()
            if message['type']=='http.disconnect':
                return
            chunk=message.get('body',b'')
            size+=len(chunk)
            if size>cap:
                return await JSONResponse({'detail':'Upload is too large.'},status_code=413)(scope,receive,safe_send)
            chunks.append(chunk)
            if not message.get('more_body',False):
                break
        body=b''.join(chunks)
        delivered=False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered=True
                return {'type':'http.request','body':body,'more_body':False}
            return await receive()
        await self.app(scope,replay,safe_send)
