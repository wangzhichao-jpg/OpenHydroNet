import json
from pathlib import Path
from tools.render_videos import subtitle_chunks, stamp


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
