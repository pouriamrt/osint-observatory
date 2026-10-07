import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Crosshair } from 'lucide-react';
import { Busy, Empty, External, Notice, SaveButton } from '../components/common';
import type { Row } from '../lib/api';
let detector: Promise<any> | undefined;
async function loadDetector() {
  detector ||= Promise.all([import('@tensorflow/tfjs-core'), import('@tensorflow-models/coco-ssd'), import('@tensorflow/tfjs-backend-webgl'), import('@tensorflow/tfjs-backend-cpu')]).then(async ([tf, coco]) => { await tf.ready(); return coco.load({ base: 'lite_mobilenet_v2' }); }).catch(e => { detector = undefined; throw e; });
  return detector;
}
export default function CameraPreview({ item, onSave }: { item: Row; onSave: () => void }) {
  const media = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const [detect, setDetect] = useState(false), [ready, setReady] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [predictions, setPredictions] = useState<Row[]>([]), [capturedAt, setCapturedAt] = useState('');
  const [dims, setDims] = useState({ width: 1, height: 1 });
  useEffect(() => {
    if (item.kind !== 'hls' || !(media.current instanceof HTMLVideoElement)) return;
    const video = media.current;
    if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = item.url; return; }
    if (!Hls.isSupported()) { setError('HLS playback is unavailable in this browser. Open the original source.'); return; }
    const hls = new Hls({ enableWorker: true }); hls.loadSource(item.url); hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) setError('The stream could not load. Check the source and its CORS settings.'); });
    return () => hls.destroy();
  }, [item]);
  useEffect(() => {
    if (!detect || !ready) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    async function scan() {
      setLoading(true);
      try {
        const model = await loadDetector(); if (cancelled || !media.current) return;
        const found = await model.detect(media.current); if (cancelled) return;
        setPredictions(found.filter((p: Row) => p.score >= .55)); setCapturedAt(new Date().toISOString()); setLoading(false);
        if (media.current instanceof HTMLVideoElement) timer = setTimeout(scan, 1500);
      } catch (e) { if (!cancelled) { setError(`Detection unavailable: ${(e as Error).message}. The feed must allow cross-origin pixel access.`); setLoading(false); setDetect(false); } }
    }
    void scan(); return () => { cancelled = true; clearTimeout(timer); };
  }, [detect, ready]);
  function loaded() { const el = media.current; if (!el) return; setDims(el instanceof HTMLImageElement ? { width: el.naturalWidth, height: el.naturalHeight } : { width: el.videoWidth, height: el.videoHeight }); setReady(true); setError(''); }
  return <section className="camera-preview"><div className="row between"><h2>{item.name}</h2><span className="tag">{item.kind === 'page' ? 'Source page' : 'Imported feed'}</span></div>{item.kind === 'page' ? <Empty title="Open the camera source">This record links to a website. Import a direct image, video, or HLS URL for playback and detection.</Empty> : <div className="media-stage">{item.kind === 'image' ? <img src={item.url} ref={el => { media.current = el; }} crossOrigin="anonymous" alt={`Public camera: ${item.name}`} onLoad={loaded} onError={() => setError('The image could not load. The source may be offline or block cross-origin access.')} /> : <video ref={el => { media.current = el; }} src={item.kind === 'video' ? item.url : undefined} crossOrigin="anonymous" controls playsInline muted onLoadedData={loaded} onError={() => setError('The video could not load. Check the direct media URL and CORS settings.')} />}{detect && predictions.map((p: Row, i) => <div className="detection-box" key={i} style={{ left: `${p.bbox[0] / dims.width * 100}%`, top: `${p.bbox[1] / dims.height * 100}%`, width: `${p.bbox[2] / dims.width * 100}%`, height: `${p.bbox[3] / dims.height * 100}%` }}><span>{p.class} {Math.round(p.score * 100)}%</span></div>)}</div>}{error && <Notice tone="error">{error}</Notice>}<div className="row wrap"><External href={item.url}>Open camera source</External>{item.kind !== 'page' && <button className={`button ${detect ? 'primary' : ''}`} disabled={!ready} onClick={() => { setDetect(!detect); setLoading(false); setPredictions([]); }}><Crosshair size={16} />{detect ? 'Stop detection' : 'Detect objects'}</button>}{loading && <Busy label="Loading detector / analyzing" />}</div><p className="muted">COCO-SSD detects object classes locally in your browser. No face recognition. The first use downloads the model; source CORS permissions are required.</p>{capturedAt && detect && <><p>{predictions.length ? `${predictions.length} objects above 55% confidence` : 'No objects detected above 55% confidence.'}</p><SaveButton key={capturedAt} module="camera" title={`Object detection · ${item.name}`} source={item.source} payload={{ camera: item, detector: 'COCO-SSD lite_mobilenet_v2', threshold: .55, predictions, capturedAt }} onSave={onSave} /></>}</section>;
}
