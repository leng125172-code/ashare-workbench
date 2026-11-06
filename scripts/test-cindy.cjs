'use strict';
const {readdirSync}=require('node:fs'),{spawnSync}=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'..'),files=readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.cjs')&&!f.startsWith('dsh')).map(f=>'tests/'+f);
const out=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit'});process.exit(out.status??1);
