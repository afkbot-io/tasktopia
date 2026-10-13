import { readWorldPreferences } from './world-preferences';
export type CitySoundCue='hammer'|'blast'|'rotor'|'reveal'|'siren'|'bell'|'chirp'|'whistle';
const scores:Record<CitySoundCue,{frequency:number;end:number;duration:number;volume:number;type:OscillatorType}>={
 hammer:{frequency:190,end:75,duration:.06,volume:.025,type:'triangle'},
 blast:{frequency:110,end:28,duration:.35,volume:.035,type:'sawtooth'},
 rotor:{frequency:44,end:38,duration:.55,volume:.012,type:'triangle'},
 reveal:{frequency:430,end:620,duration:.14,volume:.02,type:'sine'},
 siren:{frequency:500,end:710,duration:.35,volume:.012,type:'sine'},
 bell:{frequency:880,end:660,duration:.28,volume:.014,type:'sine'},
 chirp:{frequency:1200,end:1900,duration:.1,volume:.008,type:'sine'},
 whistle:{frequency:980,end:1400,duration:.16,volume:.01,type:'sine'},
};
let context:AudioContext|undefined;
let played=0;
const voices=new Set<{oscillator:OscillatorNode;gain:GainNode}>();
/** Must be called by a trusted click/tap after the personal opt-in. */
export async function unlockCityAudio(trusted:boolean){
 if(!trusted||!readWorldPreferences().sound||typeof window==='undefined'||!window.AudioContext)return;
 try{context??=new AudioContext();if(context.state==='suspended')await context.resume();}catch{/* Browser may deny audio; animation remains usable. */}
}
export function silenceCityAudio(){
 for(const voice of voices){voice.oscillator.onended=null;try{voice.oscillator.stop();}catch{/* Already ended. */}voice.oscillator.disconnect();voice.gain.disconnect();}
 voices.clear();
}
export function playCitySound(cue:CitySoundCue,attenuation=1){
 if(!Number.isFinite(attenuation)||attenuation<=0||!context||context.state!=='running'||!readWorldPreferences().sound||document.hidden||voices.size>=4)return false;
 const score=scores[cue],now=context.currentTime,oscillator=context.createOscillator(),gain=context.createGain();
 oscillator.type=score.type;oscillator.frequency.setValueAtTime(score.frequency,now);oscillator.frequency.exponentialRampToValueAtTime(score.end,now+score.duration);
 gain.gain.setValueAtTime(Math.max(.0001,score.volume*Math.min(1,attenuation)),now);gain.gain.exponentialRampToValueAtTime(.0001,now+score.duration);
 oscillator.connect(gain);gain.connect(context.destination);
 const voice={oscillator,gain};voices.add(voice);
 oscillator.onended=()=>{voices.delete(voice);oscillator.disconnect();gain.disconnect();};
 oscillator.start(now);played++;oscillator.stop(now+score.duration);return true;
}
export const cityAudioMetrics=()=>({voices:voices.size,played,state:context?.state??'locked'});
