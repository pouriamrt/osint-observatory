import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Globe2, Map as MapIcon, Minus, Plus, RotateCcw, Maximize2 } from 'lucide-react';
import { cameraColor } from '../lib/camera-colors';
import type { Row } from '../lib/api';
import StreetMapTiles from './StreetMapTiles';
import { mapBounds, mapLatitude, mapY } from '../lib/map-projection';
type Point = { id: string; lat: number; lon: number; title?: string; name?: string; category?: string; magnitude?: number; provider?: string; cameraStatus?: string };
type Runtime = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; markers: THREE.InstancedMesh | null; ids: string[]; select: THREE.Mesh; dirty: () => void; focus: (lat: number, lon: number) => void; reset: () => void; detail: () => void; cancelFocus: () => void };
const point3 = (lat: number, lon: number, radius = 1) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return new THREE.Vector3(radius * Math.cos(a) * Math.sin(b), radius * Math.sin(a), radius * Math.cos(a) * Math.cos(b)); };
const MAX_MAP_ZOOM = 65536;
const colorFor = (p: Point) => p.cameraStatus === 'offline' ? '#8b9398' : p.category === 'Earthquake' ? '#efb66c' : cameraColor(p.provider || 'EarthCam');
let geography: Promise<Row> | undefined;
const loadGeo = () => geography ||= fetch('/geo/countries.geojson').then(r => { if (!r.ok) throw new Error('Map boundaries are unavailable.'); return r.json(); }).catch(e => { geography = undefined; throw e; });
export default function Globe({ points, selected, onSelect, focus, onCluster }: { points: Point[]; selected?: string; onSelect: (id: string) => void; focus?: { lat: number; lon: number; span?: { lat: number; lon: number }; radius?: number } | null; onCluster?: (ids: string[]) => void }) {
  const host = useRef<HTMLDivElement>(null), runtime = useRef<Runtime | null>(null), selectRef = useRef(onSelect), wrap = useRef<HTMLDivElement>(null);
  const pointsRef = useRef(points), clusterRef = useRef(onCluster), detailZoom = useRef(false);
  const [view, setView] = useState<'auto' | 'globe' | 'map'>('auto'), [geo, setGeo] = useState<Row | null>(null), [error, setError] = useState(''), [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1), [center, setCenter] = useState({ lon: 0, lat: 0 }), [viewport, setViewport] = useState({ width: 800, height: 450 });
  const mapState = useRef({ zoom, center, viewport }); mapState.current = { zoom, center, viewport };
  selectRef.current = onSelect;
  pointsRef.current = points; clusterRef.current = onCluster;
  const selectedPoint = points.find(p => p.id === selected);
  const focusSpan = focus?.span || (focus?.radius ? { lat: focus.radius * 2 / 111, lon: focus.radius * 2 / (111 * Math.max(.1, Math.cos(focus.lat * Math.PI / 180))) } : null);
  const localFocus = !!focusSpan && focusSpan.lon < 15 && focusSpan.lat < 10;
  const flat = view === 'map' || (view === 'auto' && localFocus);
  const [candidateIds, setCandidateIds] = useState<string[]>([]), [candidateQuery, setCandidateQuery] = useState('');
  const candidateRows = points.filter(p => candidateIds.includes(p.id) && (p.name || p.title || '').toLowerCase().includes(candidateQuery.toLowerCase()));
  useEffect(() => {
    const ids = new Set(points.map(p => p.id));
    setCandidateIds(old => { const remaining = old.filter(id => ids.has(id)); return remaining.length === old.length ? old : remaining; });
  }, [points]);
  useEffect(() => {
    const element = host.current; if (!flat || !element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = mapState.current, bounds = mapBounds(current.center, current.zoom, current.viewport), rect = element.getBoundingClientRect();
      const nextZoom = Math.max(1, Math.min(MAX_MAP_ZOOM, current.zoom * (event.deltaY < 0 ? 1.18 : .85)));
      const next = mapBounds(current.center, nextZoom, current.viewport), px = (event.clientX - rect.left) / rect.width, py = (event.clientY - rect.top) / rect.height;
      setCenter({ lon: bounds.x + px * bounds.width - (px - .5) * next.width - 180, lat: mapLatitude(bounds.y + py * bounds.height - (py - .5) * next.height) });
      setZoom(nextZoom);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [flat]);
  const focusHeight = focusSpan && focus ? mapY(focus.lat - focusSpan.lat / 2) - mapY(focus.lat + focusSpan.lat / 2) : 0;
  const focusZoom = focusSpan ? Math.max(1, Math.min(MAX_MAP_ZOOM, Math.min(360, 360 * viewport.width / viewport.height) / (Math.max(.02, focusSpan.lon, focusHeight * viewport.width / viewport.height) * 1.35))) : 4;
  useEffect(() => { loadGeo().then(setGeo).catch(e => setError(e.message)); }, []);
  useEffect(() => { const el = host.current; if (!el) return; const resize = new ResizeObserver(() => { const rect = el.getBoundingClientRect(); setViewport({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) }); }); resize.observe(el); return () => resize.disconnect(); }, []);
  useEffect(() => {
    if (flat || !host.current || !geo) return;
    const el = host.current; let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); setError(''); } catch { setError('3D rendering is unavailable. Switch to the world map.'); return; }
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.set(-.65, .6, 3.55);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Interactive globe. Drag to rotate; scroll to zoom. Select a location from the adjacent list.');
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 1.05; controls.maxDistance = 6;
    scene.add(new THREE.AmbientLight('#b8d7d1', 1.8)); const light = new THREE.DirectionalLight('#b9e6dc', 2.1); light.position.set(-3, 3, 5); scene.add(light);
    // Cartographic land fill comes from the actual GeoJSON boundaries.
    const textureCanvas = document.createElement('canvas'); textureCanvas.width = 2048; textureCanvas.height = 1024;
    const ctx = textureCanvas.getContext('2d')!; ctx.fillStyle = '#14232c'; ctx.fillRect(0, 0, 2048, 1024); ctx.fillStyle = '#304e4b';
    const vertices: number[] = [];
    for (const feature of geo.features) {
      const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
      for (const polygon of polygons) {
        ctx.beginPath();
        for (const ring of polygon) { ring.forEach(([lon, lat]: number[], i: number) => { const x = (lon + 180) / 360 * 2048, y = (90 - lat) / 180 * 1024; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.closePath(); }
        ctx.fill('evenodd');
        for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
          const [lon1, lat1] = ring[i - 1], [lon2, lat2] = ring[i], delta = ((lon2 - lon1 + 540) % 360) - 180;
          const steps = Math.max(1, Math.ceil(Math.max(Math.abs(delta), Math.abs(lat2 - lat1)) / 2));
          for (let j = 0; j < steps; j++) vertices.push(...point3(lat1 + (lat2 - lat1) * j / steps, lon1 + delta * j / steps, 1.004).toArray(), ...point3(lat1 + (lat2 - lat1) * (j + 1) / steps, lon1 + delta * (j + 1) / steps, 1.004).toArray());
        }
      }
    }
    const texture = new THREE.CanvasTexture(textureCanvas); texture.colorSpace = THREE.SRGBColorSpace;
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 80, 80), new THREE.MeshPhongMaterial({ map: texture, shininess: 3, specular: '#20352d' })); earth.rotation.y = -Math.PI / 2; scene.add(earth);
    const boundaries = new THREE.BufferGeometry(); boundaries.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); scene.add(new THREE.LineSegments(boundaries, new THREE.LineBasicMaterial({ color: '#79a99b', transparent: true, opacity: .5 })));
    const grid: number[] = [];
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 2) grid.push(...point3(lat, lon, 1.002).toArray(), ...point3(lat, lon + 2, 1.002).toArray());
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -90; lat < 90; lat += 2) grid.push(...point3(lat, lon, 1.002).toArray(), ...point3(lat + 2, lon, 1.002).toArray());
    const gridGeometry = new THREE.BufferGeometry(); gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3)); scene.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: '#60797b', transparent: true, opacity: .17 })));
    const highlight = new THREE.Mesh(new THREE.RingGeometry(.025, .035, 32), new THREE.MeshBasicMaterial({ color: '#f1fbf5', side: THREE.DoubleSide })); highlight.visible = false; scene.add(highlight);
    let dirty = true, transition: { start: THREE.Vector3; end: THREE.Vector3; rotation: THREE.Quaternion; began: number } | null = null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches, markDirty = () => { dirty = true; };
    const enterDetail = () => { transition = null; detailZoom.current = true; const position = camera.position.clone().normalize(); setCenter({ lat: Math.asin(position.y) * 180 / Math.PI, lon: Math.atan2(position.x, position.z) * 180 / Math.PI }); setZoom(2048); setView('map'); };
    runtime.current = { scene, camera, controls, detail: enterDetail, cancelFocus: () => { transition = null; }, markers: null, ids: [], select: highlight, dirty: markDirty, focus: (lat, lon) => { const end = point3(lat, lon, Math.max(1.05, Math.min(camera.position.length(), 3.5))); if (reduced) camera.position.copy(end); else transition = { start: camera.position.clone(), end, rotation: new THREE.Quaternion().setFromUnitVectors(camera.position.clone().normalize(), end.clone().normalize()), began: performance.now() }; dirty = true; }, reset: () => { transition = null; camera.position.set(-.65, .6, 3.55); controls.update(); dirty = true; } };
    controls.addEventListener('change', () => { markDirty(); if (camera.position.length() <= 1.051) enterDetail(); }); controls.addEventListener('start', () => { transition = null; });
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let down = { x: 0, y: 0 };
    function hit(event: PointerEvent) { const rect = renderer.domElement.getBoundingClientRect(); mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); ray.setFromCamera(mouse, camera); const mesh = runtime.current?.markers; const hits = ray.intersectObjects(mesh ? [earth, mesh] : [earth]); return hits[0]?.object === mesh && hits[0].instanceId !== undefined ? runtime.current?.ids[hits[0].instanceId] : undefined; }
    const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
      const id = hit(event); if (!id) return;
      if (clusterRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        const ids = pointsRef.current.slice(0, 5000).filter(p => {
          if (p.id === id) return true;
          const position = point3(p.lat, p.lon, 1.02);
          if (position.dot(camera.position.clone().sub(position)) <= 0) return false;
          const projected = position.project(camera);
          return Math.hypot((projected.x + 1) * rect.width / 2 + rect.left - event.clientX, (1 - projected.y) * rect.height / 2 + rect.top - event.clientY) <= 24;
        }).map(p => p.id);
        if (ids.length > 1) { setCandidateIds(ids); setCandidateQuery(''); clusterRef.current(ids); return; }
      }
      selectRef.current(id);
    };
    const pointerMove = (event: PointerEvent) => { if (event.buttons) { setHover(null); return; } const id = hit(event); el.style.cursor = id ? 'pointer' : 'grab'; const rect = el.getBoundingClientRect(); setHover(old => old?.id === id ? old : id ? { id, x: Math.max(15, Math.min(event.clientX - rect.left, rect.width - 205)), y: Math.max(65, event.clientY - rect.top - 65) } : null); };
    const pointerLeave = () => setHover(null);
    el.addEventListener('pointerdown', pointerDown); el.addEventListener('pointerup', pointerUp); el.addEventListener('pointermove', pointerMove); el.addEventListener('pointerleave', pointerLeave);
    const resize = new ResizeObserver(() => { const { width, height } = el.getBoundingClientRect(); renderer.setSize(width, Math.max(height, 1)); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); dirty = true; }); resize.observe(el);
    let frame = 0, disposed = false;
    const render = () => { if (disposed) return; if (transition) { const t = Math.min(1, (performance.now() - transition.began) / 700); const ease = 1 - (1 - t) ** 3; camera.position.copy(transition.start).normalize().applyQuaternion(new THREE.Quaternion().slerp(transition.rotation, ease)).multiplyScalar(transition.start.length() + (transition.end.length() - transition.start.length()) * ease); dirty = true; if (t === 1) transition = null; } controls.update(); if (dirty) { renderer.render(scene, camera); dirty = false; } frame = requestAnimationFrame(render); }; render();
    return () => { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); el.removeEventListener('pointerdown', pointerDown); el.removeEventListener('pointerup', pointerUp); el.removeEventListener('pointermove', pointerMove); el.removeEventListener('pointerleave', pointerLeave); controls.dispose(); runtime.current = null; texture.dispose(); scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { o.geometry.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); } }); renderer.dispose(); renderer.domElement.remove(); };
  }, [flat, geo]);
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    if (r.markers) { r.scene.remove(r.markers); r.markers.geometry.dispose(); (r.markers.material as THREE.Material).dispose(); }
    const shown = points.slice(0, 5000); if (!shown.length) { r.markers = null; r.ids = []; r.select.visible = false; r.dirty(); return; }
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(.011, 8, 6), new THREE.MeshBasicMaterial(), shown.length), dummy = new THREE.Object3D();
    shown.forEach((p, i) => { dummy.position.copy(point3(p.lat, p.lon, 1.02)); dummy.scale.setScalar(p.magnitude ? Math.max(1, Math.min(2.5, p.magnitude / 2)) : 1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, new THREE.Color(colorFor(p))); });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); r.scene.add(mesh); r.markers = mesh; r.ids = shown.map(p => p.id); r.dirty(); setHover(null);
  }, [points, flat, geo]);
  useEffect(() => {
    const p = selectedPoint, r = runtime.current;
    if (r) { r.select.visible = !!p; if (p) { const normal = point3(p.lat, p.lon); r.select.position.copy(normal.clone().multiplyScalar(1.035)); r.select.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal); r.focus(p.lat, p.lon); } r.dirty(); }
    if (flat && p) { setCenter({ lat: p.lat, lon: p.lon }); setZoom(old => Math.max(old, focus ? focusZoom : 3)); }
  }, [selected, selectedPoint?.lat, selectedPoint?.lon, flat, geo, focusZoom]);
  useEffect(() => { if (!focus) { detailZoom.current = false; return; } if (!selectedPoint) runtime.current?.focus(focus.lat, focus.lon); if (flat) { if (!selectedPoint) setCenter({ lat: focus.lat, lon: focus.lon }); setZoom(detailZoom.current ? 2048 : focusZoom); detailZoom.current = false; } }, [focus?.lat, focus?.lon, flat, geo, focusZoom]);
  const bounds = mapBounds(center, zoom, viewport), { width, height, x, y } = bounds;
  const clusters = useMemo(() => { const groups = new Map<string, Point[]>(), size = 32 * Math.min(360, 360 * viewport.width / viewport.height) / (zoom * viewport.width); for (const p of points.slice(0, 5000)) { const key = `${Math.floor((p.lon + 180) / size)}:${Math.floor(mapY(p.lat) / size)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(p); } return [...groups].map(([id, rows]) => ({ id, rows, lat: mapLatitude(rows.reduce((s, p) => s + mapY(p.lat), 0) / rows.length), lon: rows.reduce((s, p) => s + p.lon, 0) / rows.length })); }, [points, zoom, viewport.width, viewport.height]);
  const path = (ring: number[][]) => ring.map(([lon, lat], i) => `${i ? 'L' : 'M'}${lon + 180},${mapY(lat)}`).join(' ') + 'Z';
  const unitsPerPixel = Math.max(width / viewport.width, height / viewport.height);
  const hoverPoint = points.find(p => p.id === hover?.id);
  function zoomBy(factor: number) { if (flat) setZoom(z => Math.max(1, Math.min(MAX_MAP_ZOOM, z * factor))); else { const r = runtime.current; if (!r) return; r.cancelFocus(); if (r.camera.position.length() / factor <= 1.05) r.detail(); else { r.camera.position.multiplyScalar(1 / factor); r.controls.update(); r.dirty(); } } }
  const drag = useRef<{ x: number; y: number; lon: number; lat: number } | null>(null);
  return <div ref={wrap} className="globe-area">
    <div ref={host} className={`globe-canvas ${flat ? 'flat' : ''}`}>
      {flat && <>
        <StreetMapTiles bounds={bounds} viewport={viewport} />
        <svg viewBox={`${x} ${y} ${width} ${height}`} role="img" aria-label="World map with research locations" className="flat-map"
          onPointerDown={e => {
            if ((e.target as Element).closest('.map-point')) return;
            drag.current = { x: e.clientX, y: e.clientY, lon: center.lon, lat: center.lat };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (!drag.current) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setCenter({
              lon: Math.max(-180, Math.min(180, drag.current.lon - (e.clientX - drag.current.x) / rect.width * width)),
              lat: mapLatitude(mapY(drag.current.lat) - (e.clientY - drag.current.y) / rect.height * height)
            });
          }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
          {geo?.features.map((f: Row, i: number) => {
            const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
            return <path key={i} vectorEffect="non-scaling-stroke" style={{ strokeWidth: .7, fill: 'none', strokeOpacity: .25 }} d={polygons.flatMap((p: number[][][]) => p.map(path)).join(' ')} />;
          })}
          {clusters.map(c => {
            const multiple = c.rows.length > 1, p = c.rows[0], activate = () => {
              const nearby = onCluster ? clusters.filter(other => Math.hypot(other.lon - c.lon, mapY(other.lat) - mapY(c.lat)) <= 24 * unitsPerPixel).flatMap(other => other.rows) : c.rows;
              if (nearby.length > 1) {
                setCenter({ lon: c.lon, lat: c.lat }); setZoom(z => Math.min(MAX_MAP_ZOOM, z * 2));
                setCandidateIds(nearby.map(p => p.id)); setCandidateQuery(''); onCluster?.(nearby.map(p => p.id));
              } else { setCandidateIds([]); onSelect(p.id); }
            };
            return <g className="map-point" key={c.id} transform={`translate(${c.lon + 180},${mapY(c.lat)})`} role="button" tabIndex={0}
              aria-label={multiple ? zoom >= MAX_MAP_ZOOM && onCluster ? `Choose from ${c.rows.length} locations` : `Zoom to ${c.rows.length} locations` : `Select ${p.name || p.title}`}
              onClick={activate} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}>
              <circle r={18 * unitsPerPixel} style={{ fill: 'transparent', stroke: 'none' }} />
              <circle r={(multiple ? 10 : selected === p.id ? 7 : 5) * unitsPerPixel} vectorEffect="non-scaling-stroke"
                style={{ fill: multiple ? '#ccede1' : colorFor(p), strokeWidth: c.rows.some(row => row.id === selected) ? 3 : 1.5, stroke: c.rows.some(row => row.id === selected) ? '#1c5549' : '#18372d' }} />
              <title>{multiple ? c.rows.map(p => p.name || p.title).join('\n') : p.name || p.title}</title>
              {multiple && <text textAnchor="middle" dominantBaseline="central" fontSize={11 * unitsPerPixel} fill="#10251f">{c.rows.length}</text>}
              {!multiple && (zoom >= 4096 || selected === p.id && zoom >= 1024) && <text x={10 * unitsPerPixel} y={4 * unitsPerPixel} fontSize={11 * unitsPerPixel} fill="#10251f" stroke="#f7f9f3" strokeWidth={3 * unitsPerPixel} paintOrder="stroke">{(p.name || p.title || '').slice(0, 38)}</text>}
            </g>;
          })}
        </svg>
      </>}
    </div>
    <div className="map-controls">
      <div className="segmented">
        <button aria-label="3D globe" className={!flat ? 'active' : ''} onClick={() => { setView('globe'); setCandidateIds([]); }}><Globe2 size={15} />Globe</button>
        <button aria-label="World map" title="Street map" className={flat ? 'active' : ''} onClick={() => { setView('map'); setCenter(selectedPoint || focus || center); setZoom(focusZoom); setCandidateIds([]); }}><MapIcon size={15} />Map</button>
      </div>
      <div className="segmented">
        <button aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus size={16} /></button>
        <button aria-label="Zoom out" onClick={() => zoomBy(.8)}><Minus size={16} /></button>
        <button aria-label="Reset globe" onClick={() => { runtime.current?.reset(); setZoom(1); setCenter({ lat: 0, lon: 0 }); }}><RotateCcw size={15} /></button>
        <button aria-label="Expand map" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void wrap.current?.requestFullscreen().catch(() => setError('Fullscreen is unavailable in this browser.')); }}><Maximize2 size={15} /></button>
      </div>
    </div>
    {candidateIds.length > 1 && <section className="map-camera-picker" role="dialog" aria-label="Cameras at this location">
      <div className="row between"><strong>{candidateIds.length} nearby cameras</strong><button className="icon-button" aria-label="Close nearby cameras" onClick={() => setCandidateIds([])}>×</button></div>
      <input aria-label="Search nearby camera choices" value={candidateQuery} onChange={e => setCandidateQuery(e.target.value)} placeholder="Search these cameras…" />
      <div className="map-camera-choices">
        {candidateRows.map(p => <button key={p.id} className="map-camera-choice" data-camera-name={p.name || p.title} aria-pressed={p.id === selected} onClick={() => onSelect(p.id)}><strong>{p.name || p.title}</strong><small>{p.cameraStatus === 'offline' ? 'Provider reports offline' : p.provider || p.category}</small></button>)}
        {!candidateRows.length && <p>No cameras match this search.</p>}
      </div>
    </section>}
    {hover && hoverPoint && <div className="globe-tooltip" style={{ left: hover.x, top: hover.y }}><strong>{hoverPoint.name || hoverPoint.title}</strong><span>{hoverPoint.provider || hoverPoint.category} · Select to inspect</span></div>}
    <div className={`map-caption ${flat ? 'street-caption' : ''}`}><span>{flat ? 'Drag to pan · Scroll to zoom · Select a pin' : 'Drag to rotate · Zoom in for the detailed map'}</span><span>{points.length.toLocaleString()} locations{points.length > 5000 ? ' · first 5,000 plotted' : ''}</span></div>
    {error && <p className="map-error">{error}</p>}
  </div>;
}
