import json
from pathlib import Path
from tools.render_videos import subtitle_chunks, stamp


def test_independent_asr_error_metric_and_negation():
    from tools.check_narration import character_error_rate, normalize
    assert character_error_rate('输入已变更，请重新计算。', '输入已变更请重新计算') == 0
    assert character_error_rate('不是真实时间动态', '是真实时间动态') > 0
    assert normalize('不是，真实时间动态。').count('不') == 1


def make_fake_audio(tmp_path, monkeypatch, late=False):
    import hashlib
    import wave
    import tools.render_videos as render
    directory=tmp_path/'quickstart';directory.mkdir()
    with wave.open(str(directory/'voice.wav'),'wb') as stream:
        stream.setparams((1,2,1000,0,'NONE','not compressed'))
        stream.writeframes(b'\x01\x00'*1000)
    digest=hashlib.sha256((directory/'voice.wav').read_bytes()).hexdigest()
    manifest=dict(engine='test-only',speaker='zm_test',model_sha256='test-only',speed=1.0,clips=[dict(file='voice.wav',text='请重新计算。',scene=0,sha256=digest)])
    (directory/'speech-manifest.json').write_text(json.dumps(manifest))
    recording=dict(software=render.VERSION,smoke=False,events=[dict(action='calculate',expected_s=0,actual_s=3.5 if late else 1.5)])
    (directory/'recording.json').write_text(json.dumps(recording))
    monkeypatch.setattr(render,'MEDIA',tmp_path)
    plan=dict(duration=4,segments=[dict(at=0,action='calculate',text='请重新计算。')])
    return render,directory,plan


def test_sentence_audio_uses_its_wav_duration_and_waits_for_real_action(tmp_path,monkeypatch):
    import pytest
    render,directory,plan=make_fake_audio(tmp_path,monkeypatch)
    render.compose_audio('quickstart',plan)
    manifest=json.loads((directory/'audio-manifest.json').read_text())
    caption=manifest['captions'][0]
    assert caption['start_s']==pytest.approx(1.75)
    assert caption['end_s']-caption['start_s']==pytest.approx(1.0)
    assert manifest['no_time_compression'] is True
    assert '00:00:01,750 --> 00:00:02,750' in (tmp_path/'quickstart.srt').read_text()
    assert 'PlayResX: 1920' in (tmp_path/'quickstart.ass').read_text()


def test_late_real_actions_reject_overlapping_or_truncated_speech(tmp_path,monkeypatch):
    import pytest
    render,directory,plan=make_fake_audio(tmp_path,monkeypatch,late=True)
    with pytest.raises(RuntimeError,match='空间不足'):
        render.compose_audio('quickstart',plan)
    assert not (directory/'narration.wav').exists()


def test_semantic_subtitles_keep_negation_in_one_caption():
    text='当前仍有设备库、表格导入、热动态等功能待完善，不能宣称已经全面超过参考软件。代码托管地址和视频上传位置尚待确认。'
    chunks=subtitle_chunks(text)
    assert ''.join(chunks)==text
    assert max(map(len,chunks))<=28
    assert any('不能宣称已经全面超过参考软件。' in chunk for chunk in chunks)
    assert not any(chunk.startswith('经全面超过') for chunk in chunks)


def test_all_storyboard_captions_roundtrip_and_length():
    plans=json.loads((Path(__file__).resolve().parents[1]/'media/storyboards.json').read_text())
    for plan in plans.values():
        for segment in plan['segments']:
            chunks=subtitle_chunks(segment['text'])
            assert ''.join(chunks)==segment['text']
            assert all(len(chunk)<=28 for chunk in chunks)
    assert stamp(120)=='00:02:00,000'


def test_spoken_text_avoids_confirmed_polyphone_dictionary_traps():
    # The pinned Chinese lexicon maps isolated 重/长 to zhong4/zhang3.
    # Use familiar phrases with correct lexical readings, not a relaxed CER gate.
    plans=json.loads((Path(__file__).resolve().parents[1]/'media/storyboards.json').read_text())
    spoken=''.join(s['text'] for p in plans.values() for s in p['segments'])
    assert all(word not in spoken for word in ('重开','重算','管长'))
    assert '再次计算' in spoken and '管道长度' in spoken


def test_whole_sentence_units_and_exact_sentence_caption_bounds():
    import pytest
    from tools.render_videos import sentences, caption_pieces
    text='先检查模型，再点击计算。程序同时核对节点质量守恒和支路能量残差，计算在独立进程中执行，结果保留算法版本和输入摘要。'
    units=sentences(text)
    assert ''.join(units)==text and len(units)==2
    pieces=caption_pieces(units[1],6.0)
    assert ''.join(p[0] for p in pieces)==units[1] and all(len(p[0])<=28 for p in pieces)
    assert pieces[0][1]==0 and pieces[-1][2]==pytest.approx(6.0)
    assert all(a[2]==pytest.approx(b[1]) for a,b in zip(pieces,pieces[1:]))
