"""Local-only UI test harness. Native services are replaced with explicit sample data."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import re, time
from urllib.parse import urlparse, parse_qs
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'plugin'),**kwargs)
    def do_GET(self):
        p=urlparse(self.path).path
        if p=='/wake':
            b=b'{"state":"running"}';typ='application/json'
        elif p=='/__preview__/trend-demo.html':
            self.send_error(404,'Optional historical preview is not part of the public source fixture');return
        elif p.startswith('/__preview__/'):
            name=p.removeprefix('/__preview__/')
            if name not in ['host.html','host.js','mobile.html','dark.css','light.css','screenshot-dark.css','review.js','mobile-boot.js']:self.send_error(404);return
            b=(ROOT/'tests/preview'/name).read_bytes()
            if name=='host.html':b=b.replace(b'/__preview__/host.js',('/__preview__/host.js?scenario='+parse_qs(urlparse(self.path).query).get('scenario',['plan'])[0]).encode())
            typ='text/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'text/html'
        elif p in ['/main-view.html','/settings.html']:
            html=(ROOT/'plugin'/p.lstrip('/')).read_text()
            scenario=parse_qs(urlparse(self.path).query).get('scenario',['plan'])[0]
            html=html.replace('<main','<iframe hidden src="/__preview__/host.html?scenario='+scenario+'"></iframe><main')
            theme=parse_qs(urlparse(self.path).query).get('theme',['light'])[0]
            if theme not in ['light','dark','screenshot-dark']:theme='light'
            html=html.replace('</head>','<link rel="stylesheet" href="/__preview__/'+theme+'.css"></head>')
            if 'mobile=1' in self.path:html=html.replace('</head>','<script src="/__preview__/mobile-boot.js"></script></head>')
            if 'screen=' in self.path:html=html.replace('</body>','<script src="/__preview__/review.js"></script></body>')
            html=re.sub(r'(src|href)="(/[^"?]+\.(?:js|css))"',lambda m:m[1]+'="'+m[2]+'?preview='+str(time.time_ns())+'"',html)
            b=html.encode();typ='text/html; charset=utf-8'
        else:return super().do_GET()
        self.send_response(200);self.send_header('Content-Type',typ);self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def log_message(self,*args):pass
print('Offline UI fixture: http://127.0.0.1:38741/main-view.html',flush=True)
ThreadingHTTPServer(('127.0.0.1',38741),Handler).serve_forever()
