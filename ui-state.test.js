import test from 'node:test';
import assert from 'node:assert/strict';
import { uiState } from './spherex-map/public/ui-state.js';
test('explore with no overlay',()=>assert.equal(uiState({}), 'explore'));
test('investigate after selecting object or lesson',()=>{assert.equal(uiState({inspectorOpen:true}),'investigate');assert.equal(uiState({lessonOpen:true}),'investigate')});
test('search takes visual priority without discarding selected object',()=>{const s={inspectorOpen:true,searchOpen:true};assert.equal(uiState(s),'search');s.searchOpen=false;assert.equal(uiState(s),'investigate')});
test('closing selection returns to exploration',()=>assert.equal(uiState({inspectorOpen:false,lessonOpen:false,searchOpen:false}),'explore'));
