import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, chooseTool, toggleTool, closeTool, moveTool, setTune, validateState, layoutProfile, launcherFor, defaultRect, clampRect, anchorRect, resolveRect } from '../web/tool-windows.js';

test('one tool opens, switches, and toggles closed without changing palette bounds',()=>{
 let s=initialState(); assert.equal(s.main,null);
 s=toggleTool(s,'pairs'); assert.equal(s.main,'pairs');
 const rect={ax:'right',ay:'top',dx:92,dy:200,w:320,h:500};
 s=moveTool(s,'pairs',rect);
 s=toggleTool(s,'lattice');assert.equal(s.main,'lattice');assert.deepEqual(s.rects.main,rect);
 s=toggleTool(s,'lattice');assert.equal(s.main,null);assert.deepEqual(s.rects.main,rect);
 s=chooseTool(s,'pairs');assert.equal(s.main,'pairs');
 assert.equal(toggleTool(s,'unknown'),s);
 assert.equal(closeTool(s,'lattice'),s);
});
test('Tune belongs to the active tool and ends on close/switch',()=>{
 let s=setTune(initialState(),true);assert.equal(s.tune,false);
 s=setTune(chooseTool(s,'pairs'),true);assert.equal(s.tune,true);
 assert.equal(chooseTool(s,'pairs').tune,true);
 assert.equal(chooseTool(s,'lattice').tune,false);
 assert.equal(toggleTool(s,'pairs').tune,false);
});
test('legacy pinned layouts restore just their front tool and its position',()=>{
 const r={ax:'left',ay:'top',dx:42,dy:130,w:300,h:400};
 const raw={main:'pairs',pinned:['lattice'],minimized:['pairs'],order:['pairs','lattice'],rects:{lattice:r},tune:true};
 const s=validateState(raw);assert.deepEqual(s,{main:'lattice',rects:{main:r},tune:true});
 assert.deepEqual(validateState(s),s);
 assert.deepEqual(validateState({main:null,pinned:[],rects:{}}),initialState());
 assert.equal(validateState(null),null);
 assert.deepEqual(validateState({main:'bogus',rects:{main:{w:NaN}}}),initialState());
});
test('responsive palettes remain bounded and desktop anchors survive orientation changes',()=>{
 for(const [width,height,profile,launcher] of [[1440,844,'float','rail'],[1024,711,'float','rail'],[768,967,'sheet','rail'],[390,787,'sheet','menu'],[844,333,'side','menu']]){
  const ws={width,height};assert.equal(layoutProfile(ws),profile);assert.equal(launcherFor(ws),launcher);
  const r=defaultRect(profile,ws,{paletteTop:250,railColumn:92,bottomGap:40,sideTop:72});
  assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=width&&r.y+r.h<=height);
  assert.ok(r.h>=170 && r.h<=720, "usable bounded editor height");
 }
 const ws={width:1440,height:844},r={x:988,y:242,w:360,h:562};
 assert.deepEqual(resolveRect(anchorRect(r,ws),ws),r);
 const c=clampRect(r,{width:960,height:600});assert.ok(c.x+c.w<=960&&c.y+c.h<=600);
});
