import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TaskMonitor } from './core/monitor.mjs';
export default defineConfig({base:'./',plugins:[react(),{
  name:'local-codex-preview',
  configureServer(server) {
    const monitor=new TaskMonitor().start();server.httpServer?.once('close',()=>monitor.stop());
    server.middlewares.use('/api/tasks',(req,res)=>{
      // Local preview only; deny cross-origin reads and DNS rebinding.
      if (req.headers.host !== '127.0.0.1:5178' && req.headers.host !== 'localhost:5178') {res.statusCode=403;res.end();return;}
      if (req.headers.origin && !['http://127.0.0.1:5178','http://localhost:5178'].includes(req.headers.origin)) {res.statusCode=403;res.end();return;}
      if(req.method!=='GET'){res.statusCode=405;res.end();return;}
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(monitor.snapshot));
    });
  }
}],build:{chunkSizeWarningLimit:1400}});
