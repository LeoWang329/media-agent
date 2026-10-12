import { LEAD_MARK } from '@media-agent/shared';
import type { Autodl } from './autodl';
import * as comfy from './client';
import { connect as sshConnect, quote, run as sshRun } from './ssh';

// 生成视频那台的 ComfyUI 装在哪：SelfLift 接续那套要把上一段出的片子拷进 input 目录，下一段才读得到，见 docs/dev-plan.md 5.32。
// 这版 ComfyUI 的「文件名[output]」写法是坏的（annotated_filepath 少截一个字符），所以只能拷进 input
export const COMFY_DIR = '/root/ComfyUI';
export const COMFY_OUTPUT = `${COMFY_DIR}/output`;
export const COMFY_INPUT = `${COMFY_DIR}/input`;

// 「续写起点」那段前一段视频，见 docs/dev-plan.md 5.35：传上那台，再规整成能接的形状。
// 为什么要规整：最后是把前一段和这次出的几段用 ConcatenateVideo 接成一条，它要么原样接（各段的编码参数得一样），
// 要么各段都重编一遍（重编改不了尺寸、帧率、位深、色彩），所以前一段的宽高、帧率、有没有声音得跟出的那几段对上
export type LeadClip = { name: string; uploaded?: string; seconds?: number; fixed: boolean };

type Size = { width: number; height: number };
// 前一段视频探到的东西：宽高、每秒几帧、8 位 yuv420p、画面色彩、有没有声音、多长、声音多少 Hz 几声道
type Probed = {
  codec: string;
  width: number;
  height: number;
  fps: number;
  pixFmt: string;
  transfer: string;
  hasAudio: boolean;
  audioRate: number;
  channels: number;
  seconds: number | null;
};

// 那台上找 ffmpeg：系统装的优先，没有就用 ComfyUI 那个 python 里 imageio_ffmpeg 自带的一版
const FIND_FFMPEG = [
  'FF=$(command -v ffmpeg || true)',
  'FP=$(command -v ffprobe || true)',
  'if [ -z "$FF" ] && [ -x /root/miniconda3/bin/python ]; then',
  '  FF=$(/root/miniconda3/bin/python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())" 2>/dev/null || true)',
  'fi',
].join('\n');

const PROBE_ENTRIES = 'stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,color_transfer,sample_rate,channels';
const PROBE_ARGS = `-v error -show_entries ${PROBE_ENTRIES} -show_entries format=duration -of json`;

// 量一次：那台上连 ffprobe 都没有就返回 null（那就老老实实规整一遍）
export async function probeLead(conn: Awaited<ReturnType<typeof sshConnect>>, file: string, size: Size): Promise<Probed | null> {
  const ran = await sshRun(
    conn,
    [
      'set -u',
      `${LEAD_MARK.probe} ${size.width} ${size.height}`,
      FIND_FFMPEG,
      'if [ -z "$FF" ]; then echo NOFFMPEG; exit 0; fi',
      'echo "---PROBE---"',
      `if [ -n "$FP" ]; then "$FP" ${PROBE_ARGS} ${quote(file)} 2>/dev/null; fi`,
      `if [ -z "$FP" ]; then "$FF" -hide_banner -i ${quote(file)} 2>&1 | grep -E "Duration:|Stream #" ; fi`,
    ].join('\n'),
  );
  const body = ran.out.split('---PROBE---')[1]?.trim() ?? '';
  if (body.startsWith('{')) return fromJson(body);
  // 没有 ffprobe：只能从 ffmpeg 那几行里看出有没有声音、多长，规格一律按「要规整」算
  const audio = /Stream #\d+:\d+.*: Audio:/.test(body);
  const duration = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(body);
  const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null;
  return { codec: '', width: 0, height: 0, fps: 0, pixFmt: '', transfer: '', hasAudio: audio, audioRate: 0, channels: 0, seconds };
}

// 传上去、量一下，能原样接就原样用；不行就规整一份出来。name 是底下传上去叫什么（按任务起名，出完一起删）
export async function prepareLead(autodl: Autodl, url: string, file: string, size: Size, name: string): Promise<LeadClip> {
  const uploaded = await comfy.uploadFile(url, file, name);
  const conn = await sshConnect(await autodl.ssh());
  try {
    const probed = await probeLead(conn, `${COMFY_INPUT}/${uploaded}`, size);
    if (!probed) throw new Error('那台上没找到 ffmpeg，前一段视频规整不了');
    // 已经能接的（尺寸、帧率、8 位、有声音都对得上）就原样用：拼接时能不重编就不重编
    if (fits(probed, size)) return { name: uploaded, seconds: probed.seconds ?? undefined, fixed: false };
    const fixed = `${uploaded.replace(/(\.[a-z0-9]+)$/i, '')}-fix.mp4`;
    const after = await transcode(conn, `${COMFY_INPUT}/${uploaded}`, `${COMFY_INPUT}/${fixed}`, size, probed.hasAudio);
    return { name: fixed, uploaded, seconds: after?.seconds ?? probed.seconds ?? undefined, fixed: true };
  } finally {
    conn.end();
  }
}

// 出片那几段长什么样，SELF_LIFT/AUDIO_RATE 就是照它来的：h264、8 位 yuv420p、24 帧、bt709 系（sRGB）、
// 声音是 H3 的音频 VAE 出的 aac 32000 立体声。这几样对上了，拼接那条走「原样接」（不重编）——
// 差一样，ComfyUI 会按第一段的参数把每段重编一遍，而重编出来的 SPS/PPS 未必一致（真机上撞过：
// `Video chunk 1 could not be encoded compatibly: extradata: expected … got …`），所以宁可先规整成一样的
const AUDIO_RATE = 32000;

// 能原样接：宽高一样、24 帧、h264 8 位的 yuv420p、色彩是 bt709 系（或者没标）、有声音、声音也是 32 kHz 立体声
const fits = (probed: Probed, { width, height }: Size) =>
  probed.width === width &&
  probed.height === height &&
  Math.abs(probed.fps - 24) < 0.05 &&
  probed.codec === 'h264' &&
  (probed.pixFmt === 'yuv420p' || probed.pixFmt === 'yuvj420p') &&
  (probed.transfer === '' || probed.transfer === 'bt709' || probed.transfer === 'iec61966-2-1') &&
  probed.hasAudio &&
  probed.audioRate === AUDIO_RATE &&
  probed.channels === 2;

// 规整一份：缩到出片大小（比例不一样的两边补黑边）、24 帧、8 位 yuv420p、h264；
// 色彩照 ComfyUI 那边写 sRGB 的写法（primaries bt709、传输特性 iec61966-2-1），
// 声音 aac 32000 立体声，没声音的补一条静音——这几样和出的那几段一模一样，拼接才是原样接（真机试出来的，见 docs/reports/selflift-u37.md）
async function transcode(
  conn: Awaited<ReturnType<typeof sshConnect>>,
  from: string,
  to: string,
  size: Size,
  hasAudio: boolean,
): Promise<Probed | null> {
  const filters = `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p`;
  const encode = [
    '-c:v libx264',
    '-crf 18',
    '-pix_fmt yuv420p',
    '-color_primaries bt709',
    '-color_trc iec61966-2-1',
    '-colorspace bt709',
    '-c:a aac',
    `-ar ${AUDIO_RATE}`,
    '-ac 2',
    '-movflags +faststart',
  ];
  const common = `-y -hide_banner -loglevel error -i ${quote(from)}`;
  const silent = `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`;
  const ran = await sshRun(
    conn,
    [
      'set -u',
      `${LEAD_MARK.fix} ${to} ${size.width} ${size.height}`,
      FIND_FFMPEG,
      'if [ -z "$FF" ]; then echo NOFFMPEG; exit 0; fi',
      `rm -f ${quote(to)}`,
      hasAudio
        ? `"$FF" ${common} -vf "${filters}" -map 0:v:0 -map 0:a:0? ${encode.join(' ')} ${quote(to)} || { echo "---ERR--- 转码失败"; exit 4; }`
        : `"$FF" ${common} ${silent} -vf "${filters}" -map 0:v:0 -map 1:a:0 -shortest ${encode.join(' ')} ${quote(to)} || { echo "---ERR--- 转码失败"; exit 4; }`,
      'echo "---FIXED---"',
      `if [ -n "$FP" ]; then "$FP" ${PROBE_ARGS} ${quote(to)} 2>/dev/null; fi`,
    ].join('\n'),
  );
  const after = ran.out.split('---FIXED---')[1]?.trim() ?? '';
  if (ran.code !== 0 || !after.startsWith('{')) {
    const why = ran.err.trim().split('\n')[0] || (ran.out.includes('NOFFMPEG') ? '那台上没找到 ffmpeg' : '');
    throw new Error(`前一段视频规整成出片大小没成功${why ? `：${why}` : ''}`);
  }
  const probed = fromJson(after);
  // 规整完还得跟出片对得上：对不上别往下发，不然拼接那条会报一句看不懂的 extradata
  if (!fits(probed, size)) {
    throw new Error(`前一段视频规整完还是跟出片对不上（${probed.width}×${probed.height}、${probed.fps} 帧、${probed.codec}、声音 ${probed.audioRate}Hz×${probed.channels}），接不了`);
  }
  return probed;
}

function fromJson(text: string): Probed {
  const parsed = JSON.parse(text) as { streams?: Record<string, unknown>[]; format?: { duration?: string } };
  const streams = parsed.streams ?? [];
  const video = streams.find((one) => one.codec_type === 'video');
  const audio = streams.find((one) => one.codec_type === 'audio');
  const [num, den] = String(video?.avg_frame_rate ?? '0/1').split('/');
  const fps = Number(num) / Number(den || 1);
  return {
    codec: String(video?.codec_name ?? ''),
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    fps: Number.isFinite(fps) ? fps : 0,
    pixFmt: String(video?.pix_fmt ?? ''),
    transfer: String(video?.color_transfer ?? '').toLowerCase(),
    hasAudio: Boolean(audio),
    audioRate: Number(audio?.sample_rate ?? 0),
    channels: Number(audio?.channels ?? 0),
    seconds: parsed.format?.duration ? Number(parsed.format.duration) : null,
  };
}
