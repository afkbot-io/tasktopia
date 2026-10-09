import { afterEach, expect, it, vi } from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('creates audio only after trusted opt-in, bounds voices, silences hidden/muted scenes and disconnects nodes',async()=>{
 const nodes:{onended:(()=>void)|null;frequency:{setValueAtTime:ReturnType<typeof vi.fn>;exponentialRampToValueAtTime:ReturnType<typeof vi.fn>};connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>}[]=[];
 const param=()=>({setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()});
 const create=vi.fn(),gains:ReturnType<typeof param>[]=[];
 class Audio {state='running';currentTime=1;destination={};constructor(){create();}resume=vi.fn(async()=>{});createGain(){const gain=param();gains.push(gain);return{gain,connect:vi.fn(),disconnect:vi.fn()};}createOscillator(){const node={onended:null,frequency:param(),connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};nodes.push(node);return node;}}
 vi.stubGlobal('window',{AudioContext:Audio,localStorage:{getItem:()=>null,setItem:vi.fn()},addEventListener:vi.fn()});vi.stubGlobal('AudioContext',Audio);const visibility={hidden:false};vi.stubGlobal('document',visibility);
 const preferences=await import('../src/client/world-preferences'),sound=await import('../src/client/city-audio');
 await sound.unlockCityAudio(true);expect(create).not.toHaveBeenCalled();expect(sound.playCitySound('blast')).toBe(false);
 preferences.setWorldPreferences({sound:true});await sound.unlockCityAudio(false);expect(create).not.toHaveBeenCalled();
 await sound.unlockCityAudio(true);expect(create).toHaveBeenCalledTimes(1);
 expect(sound.playCitySound('hammer',Number.NaN)).toBe(false);expect(sound.playCitySound('hammer',0)).toBe(false);
 for(const cue of ['hammer','rotor','blast','siren'] as const)expect(sound.playCitySound(cue,.5)).toBe(true);
 expect(gains[0]!.setValueAtTime).toHaveBeenCalledWith(.0125,1);
 expect(sound.playCitySound('reveal')).toBe(false);expect(sound.cityAudioMetrics().voices).toBe(4);
 visibility.hidden=true;expect(sound.playCitySound('reveal')).toBe(false);
 sound.silenceCityAudio();expect(sound.cityAudioMetrics().voices).toBe(0);for(const node of nodes)expect(node.disconnect).toHaveBeenCalledTimes(1);
 visibility.hidden=false;preferences.setWorldPreferences({sound:false});expect(sound.playCitySound('hammer')).toBe(false);
});
