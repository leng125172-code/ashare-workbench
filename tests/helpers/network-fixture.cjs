'use strict';
const {createTransport}=require('../../plugin/node/network.cjs');
module.exports=https=>({request:createTransport({https:{...https,Agent:class{destroy(){}}},env:{}})});
