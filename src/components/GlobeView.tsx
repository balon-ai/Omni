import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { subscribe } from '@/hooks/ticker'
import { useConfig } from '@/hooks/useConfig'

// ── Atmosphere shader ─────────────────────────────────────────────────────────
const atmVert = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal   = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const atmFrag = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec3 viewDir = normalize(-vPosition);
    float rim    = 1.0 - abs(dot(vNormal, viewDir));
    rim = pow(rim, 2.4);
    // Stark blue atmosphere
    vec3 innerCol = vec3(0.00, 0.50, 0.90);
    vec3 outerCol = vec3(0.00, 0.18, 0.55);
    vec3 col = mix(innerCol, outerCol, rim);
    gl_FragColor = vec4(col, rim * 0.55);
  }
`

// ── Arc beam shader — single bright traveller with tail ──────────────────────
const arcPartVert = /* glsl */`
  attribute float aProgress;  // 0..1 position along arc
  attribute float aSize;
  uniform float uTime;
  uniform float uSpeed;
  varying float vAlpha;
  varying float vDist;

  void main() {
    float head = fract(uTime * uSpeed);

    // Wrap-aware distance so the tail doesn't glitch at the 0/1 boundary
    float d = aProgress - head;
    if (d >  0.5) d -= 1.0;
    if (d < -0.5) d += 1.0;

    // Tail fades in over 0.22 behind head
    float tail = smoothstep(-0.22, -0.01, d) * (1.0 - smoothstep(-0.01, 0.0, d));
    // Bright head spike
    float head_glow = smoothstep(0.018, 0.0, abs(d));

    vAlpha = clamp(tail * 0.65 + head_glow * 1.0, 0.0, 1.0);
    vDist  = d;

    gl_PointSize = aSize * (0.5 + vAlpha * 1.2);
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const arcPartFrag = /* glsl */`
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    // Soft round point
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d * d) * vAlpha;
    // Add a bright core
    float core = smoothstep(0.5, 0.0, d) * vAlpha * 0.6;
    gl_FragColor = vec4(uColor + core, a);
  }
`

// ── Known nodes — real locations ─────────────────────────────────────────────
// These are placeholder fallback values used before omni.config.json loads.
// Set real coordinates in omni.config.json → nodes[].lat / .lon
const DEFAULT_NODES = [
  { id: 'local',   label: 'THIS NODE', lat:  0.0, lon:   0.0, color: 0x00e5ff, r: 0.030 },
  { id: 'remote',  label: 'REMOTE',    lat:  0.0, lon:   0.0, color: 0x00e5ff, r: 0.022 },
  { id: 'vpn',     label: 'VPN',       lat:  0.0, lon:   0.0, color: 0x80f0ff, r: 0.022 },
]

// Major city dots
const CITIES = [
  { lat: 40.71, lon: -74.01 }, { lat: 51.51, lon: -0.13  },
  { lat: 48.86, lon:  2.35  }, { lat: 35.69, lon: 139.69 },
  { lat: 22.30, lon: 114.18 }, { lat: -33.87, lon: 151.21},
  { lat: 37.77, lon: -122.42}, { lat: 55.75, lon:  37.62 },
  { lat:  1.35, lon: 103.82 }, { lat: 19.43, lon: -99.13 },
  { lat: -23.55, lon: -46.63}, { lat: 28.61, lon:  77.21 },
]

function latLon(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi   = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  )
}

// ── Lat/lon grid lines ────────────────────────────────────────────────────────
function buildGrid(R: number) {
  const pts: number[] = []
  for (let lat = -80; lat <= 80; lat += 15) {
    for (let lon = 0; lon < 360; lon += 2) {
      const a = latLon(lat, lon,     R)
      const b = latLon(lat, lon + 2, R)
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  for (let lon = 0; lon < 360; lon += 15) {
    for (let lat = -88; lat < 88; lat += 2) {
      const a = latLon(lat,     lon, R)
      const b = latLon(lat + 2, lon, R)
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  // Very dark grid — land outlines will stand out over it
  return new THREE.LineSegments(geo,
    new THREE.LineBasicMaterial({ color: 0x071828, transparent: true, opacity: 0.5 }))
}

// ── GeoJSON land outlines ─────────────────────────────────────────────────────
type GeoRing   = number[][]
type GeoPolygon = GeoRing[]
type GeoMultiPolygon = GeoPolygon[]

function ringToSegments(ring: GeoRing, R: number, pts: number[]) {
  for (let i = 0; i < ring.length - 1; i++) {
    const [lonA, latA] = ring[i]
    const [lonB, latB] = ring[i + 1]
    const a = latLon(latA, lonA, R)
    const b = latLon(latB, lonB, R)
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
}

async function buildLandOutlines(R: number): Promise<THREE.LineSegments> {
  const resp = await fetch('/land.geojson')
  const geojson = await resp.json() as {
    features: Array<{
      geometry: {
        type: 'Polygon' | 'MultiPolygon'
        coordinates: GeoPolygon | GeoMultiPolygon
      }
    }>
  }

  const pts: number[] = []

  for (const feature of geojson.features) {
    const { type, coordinates } = feature.geometry
    if (type === 'Polygon') {
      for (const ring of coordinates as GeoPolygon) {
        ringToSegments(ring, R, pts)
      }
    } else if (type === 'MultiPolygon') {
      for (const polygon of coordinates as GeoMultiPolygon) {
        for (const ring of polygon) {
          ringToSegments(ring, R, pts)
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  // Stark blue land outlines — brightest element on the globe surface
  return new THREE.LineSegments(geo,
    new THREE.LineBasicMaterial({ color: 0x0099bb, transparent: true, opacity: 0.85 }))
}

// ── Arc helpers ───────────────────────────────────────────────────────────────
function buildArcPoints(a: THREE.Vector3, b: THREE.Vector3, R: number, n = 80) {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = new THREE.Vector3().lerpVectors(a, b, t)
    p.normalize().multiplyScalar(R + 0.18 * Math.sin(Math.PI * t))
    pts.push(p.clone())
  }
  return pts
}

function buildArc(pts: THREE.Vector3[], color: number, opacity: number) {
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))
}

function buildArcParticles(pts: THREE.Vector3[], color: THREE.Color, speed = 0.22) {
  const n         = pts.length
  const positions = new Float32Array(n * 3)
  const progresses = new Float32Array(n)
  const sizes      = new Float32Array(n)

  pts.forEach((p, i) => {
    positions[i * 3]     = p.x
    positions[i * 3 + 1] = p.y
    positions[i * 3 + 2] = p.z
    progresses[i] = i / (n - 1)
    sizes[i] = 1.2 + Math.random() * 0.8
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position',  new THREE.BufferAttribute(positions,  3))
  geo.setAttribute('aProgress', new THREE.BufferAttribute(progresses, 1))
  geo.setAttribute('aSize',     new THREE.BufferAttribute(sizes,      1))

  return new THREE.Points(geo, new THREE.ShaderMaterial({
    vertexShader: arcPartVert, fragmentShader: arcPartFrag,
    uniforms: {
      uTime:  { value: 0 },
      uSpeed: { value: speed },
      uColor: { value: color },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }))
}

function buildPulseRing(color: number) {
  const r   = 0.04
  const geo = new THREE.RingGeometry(r, r + 0.006, 64)
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  return new THREE.Mesh(geo, mat)
}

// ── Component ─────────────────────────────────────────────────────────────────
export function GlobeView() {
  const mountRef = useRef<HTMLDivElement>(null)
  const cfg      = useConfig()

  // Resolve nodes from config or fall back to defaults
  const nodes = cfg.nodes.length > 0
    ? cfg.nodes.map(n => ({
        ...n,
        color: parseInt((n.color ?? '#00e5ff').replace('#', ''), 16),
      }))
    : DEFAULT_NODES

  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 0.1, 100)
    camera.position.set(0, 0.5, 3.0)

    const renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: true,
      powerPreference: 'high-performance',
      precision: 'mediump',
      stencil: false,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)

    const R     = 1.0
    const globe = new THREE.Group()

    // Grid
    globe.add(buildGrid(R))

    // Atmosphere
    globe.add(new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.06, 48, 48),
      new THREE.ShaderMaterial({
        vertexShader: atmVert, fragmentShader: atmFrag,
        transparent: true, side: THREE.FrontSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    ))

    // Dark ocean base
    globe.add(new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.998, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x010912 }),
    ))

    // Land outlines — async, add to globe when ready
    buildLandOutlines(R).then(landLines => globe.add(landLines))

    // City dots
    CITIES.forEach(c => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x1a3a5c, transparent: true, opacity: 0.7 }),
      )
      dot.position.copy(latLon(c.lat, c.lon, R + 0.005))
      globe.add(dot)
    })

    // Node markers
    const nodeVecs: THREE.Vector3[] = []
    const pulseRings: Array<{ mesh: THREE.Mesh; color: number }> = []

    nodes.forEach(node => {
      const pos = latLon(node.lat, node.lon, R)
      nodeVecs.push(pos)

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(node.r, 8, 8),
        new THREE.MeshBasicMaterial({ color: node.color }),
      )
      dot.position.copy(pos)
      globe.add(dot)

      // Halo
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(node.r * 2.5, 8, 8),
        new THREE.MeshBasicMaterial({ color: node.color, transparent: true, opacity: 0.10 }),
      )
      halo.position.copy(pos)
      globe.add(halo)

      // Pulse ring
      const pr = buildPulseRing(node.color)
      pr.position.copy(pos)
      pr.lookAt(new THREE.Vector3(0, 0, 0))
      globe.add(pr)
      pulseRings.push({ mesh: pr, color: node.color })
    })

    // Connection arcs — 512 pts for sub-pixel smooth beam travel
    const arcPts01 = buildArcPoints(nodeVecs[0], nodeVecs[1], R, 512)
    const arcPts02 = buildArcPoints(nodeVecs[0], nodeVecs[2], R, 512)
    globe.add(buildArc(arcPts01, 0x00e5ff, 0.30))
    globe.add(buildArc(arcPts02, 0x00e5ff, 0.30))

    // Different speeds so beams feel independent
    const arcPart1 = buildArcParticles(arcPts01, new THREE.Color(0x00e5ff), 0.20)
    const arcPart2 = buildArcParticles(arcPts02, new THREE.Color(0x80f0ff), 0.27)
    globe.add(arcPart1, arcPart2)

    scene.add(globe)

    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', onResize)

    const pulsePhases = pulseRings.map((_, i) => i * (Math.PI * 2 / pulseRings.length))

    const unsub = subscribe((elapsed, delta) => {
      globe.rotation.y += delta * 0.09

      ;(arcPart1.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed
      ;(arcPart2.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed

      pulseRings.forEach(({ mesh }, i) => {
        const cycle = ((elapsed * 0.7 + pulsePhases[i] / (Math.PI * 2)) % 1.0)
        mesh.scale.setScalar(1 + cycle * 3.5)
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = (1 - cycle) * 0.6
      })

      renderer.render(scene, camera)
    })

    return () => {
      unsub()
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [nodes.length])  // re-init when config-driven nodes first load

  return <div ref={mountRef} className="globe-canvas" />
}
