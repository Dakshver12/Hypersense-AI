import { $ } from './dom.js';
import { state } from './state.js';
import { refresh } from './ui.js';

export const PRESETS_KEY = 'hypersense-setups-v1';
const choices = {
  'interview-type':['technical','behavioral','hr','mixed'],
  difficulty:['easy','medium','hard'], language:['English','Hindi','Hinglish'],
  duration:['30','60','90'], 'session-count':['5','10'],
  'candidate-level':['unspecified','student','entry','experienced','senior'],
  'auto-flow':['auto','manual'],
};
const textFields = {technology:80,'target-role':160};
const idle = () => !state.busy && !state.recording && !state.interviewSession?.active;
const nameKey = name => name.normalize('NFKC').toLowerCase();
export function validatePreset(item) {
  if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 60 || !item.settings) throw Error('Invalid saved setup.');
  const settings = {};
  for (const [id, values] of Object.entries(choices)) {
    if (!values.includes(item.settings[id])) throw Error('Invalid saved setup setting: '+id);
    settings[id]=item.settings[id];
  }
  for (const [id, limit] of Object.entries(textFields)) {
    if (typeof item.settings[id] !== 'string' || item.settings[id].length > limit) throw Error('Invalid saved setup setting: '+id);
    settings[id]=item.settings[id].trim();
  }
  return {name:item.name.trim(),settings};
}
export function readPresets() {
  const items=JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
  if(!Array.isArray(items) || items.length > 20) throw Error('Saved setups could not be read.');
  return items.map(validatePreset);
}
export function capturePreset(name) {
  const settings={};
  for(const id of [...Object.keys(choices),...Object.keys(textFields)]) settings[id]=$(id).value;
  return validatePreset({name,settings});
}
export function savePreset(item, replace = false) {
  const clean=validatePreset(item), items=readPresets();
  const index=items.findIndex(old=>nameKey(old.name)===nameKey(clean.name));
  if(index>=0) {if(!replace)return false;items[index]=clean;}
  else {if(items.length>=20)throw Error('You have 20 saved setups. Delete one before adding another.');items.push(clean);}
  localStorage.setItem(PRESETS_KEY,JSON.stringify(items));return true;
}
export function applyPreset(item) {
  if(!idle())throw Error('Finish the current interview or operation first.');
  const clean=validatePreset(item);
  for(const [id,value] of Object.entries(clean.settings)) $(id).value=value;
  refresh();
}
export function renderPresets(selected='') {
  const select=$('saved-setup');if(!select)return;
  select.replaceChildren(new Option('Choose a saved setup',''));
  for(const item of readPresets())select.add(new Option(item.name,item.name));
  select.value=selected;
}
export function initPresets() {
  if(!$('saved-setup'))return;
  const status=$('preset-status');
  const action=fn=>()=>{
    if(!idle()){status.textContent='Finish the current interview or operation first.';return;}
    try{fn();}catch(error){status.textContent=error.message;}
  };
  const selected=()=>{
    const item=readPresets().find(p=>p.name===$('saved-setup').value);
    if(!item)throw Error('Choose a saved setup first.');return item;
  };
  $('preset-save').onclick=action(()=>{
    const item=capturePreset($('preset-name').value);
    if(!savePreset(item))throw Error('That name is already saved. Choose it and use Update selected, or enter a new name.');
    renderPresets(item.name);status.textContent='Setup saved in this browser.';
  });
  $('preset-load').onclick=action(()=>{
    const item=selected();applyPreset(item);$('preset-name').value=item.name;
    status.textContent='Setup loaded. Review the form before continuing. Existing résumé, job description, practice focus, question source and manual questions were kept; camera consent was not changed.';
  });
  $('preset-update').onclick=action(()=>{
    const item=selected();
    if(!window.confirm(`Replace settings in “${item.name}” with the current form settings?`))return;
    savePreset(capturePreset(item.name),true);status.textContent='Selected setup updated.';
  });
  $('preset-delete').onclick=action(()=>{
    const item=selected();
    if(!window.confirm(`Delete saved setup “${item.name}”? Interview history will be kept.`))return;
    localStorage.setItem(PRESETS_KEY,JSON.stringify(readPresets().filter(p=>p.name!==item.name)));
    renderPresets();status.textContent='Saved setup deleted. Your current form and interview history were kept.';
  });
  try{renderPresets();}catch(error){status.textContent=error.message;}
}
