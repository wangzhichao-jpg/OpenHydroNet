"""Offline Mandarin WAV via installed eSpeak NG shared library, no cloud calls."""
import ctypes as C
import ctypes.util
import wave
from pathlib import Path


def synthesize(text,output,rate=205):
    library=ctypes.util.find_library('espeak-ng')
    if not library:raise RuntimeError('未安装 eSpeak NG 共享库；不自动改用云配音')
    e=C.CDLL(library)
    e.espeak_Initialize.argtypes=[C.c_int,C.c_int,C.c_char_p,C.c_int]
    sample_rate=e.espeak_Initialize(2,0,None,0)
    if sample_rate<=0:raise RuntimeError('eSpeak 初始化失败')
    e.espeak_SetVoiceByName.argtypes=[C.c_char_p]
    if e.espeak_SetVoiceByName(b'cmn')!=0:raise RuntimeError('缺少中文 cmn 声音')
    e.espeak_SetParameter(1,rate,0);e.espeak_SetParameter(2,95,0)
    chunks=[]
    callback_type=C.CFUNCTYPE(C.c_int,C.POINTER(C.c_short),C.c_int,C.c_void_p)
    @callback_type
    def callback(samples,count,_):
        if samples and count:chunks.append(C.string_at(samples,count*2))
        return 0
    e.espeak_SetSynthCallback.argtypes=[callback_type];e.espeak_SetSynthCallback(callback)
    e.espeak_Synth.argtypes=[C.c_void_p,C.c_size_t,C.c_uint,C.c_int,C.c_uint,C.c_uint,C.c_void_p,C.c_void_p]
    encoded=text.encode('utf-8')+b'\0';buffer=C.create_string_buffer(encoded)
    code=e.espeak_Synth(buffer,len(encoded),0,1,0,1,None,None)
    e.espeak_Synchronize();e.espeak_Terminate()
    if code or not chunks:raise RuntimeError('中文音频合成失败')
    with wave.open(str(output),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(sample_rate);f.writeframes(b''.join(chunks))
    return sum(map(len,chunks))/2/sample_rate

if __name__=='__main__':
    import sys
    print(synthesize(sys.argv[1],Path(sys.argv[2])))
