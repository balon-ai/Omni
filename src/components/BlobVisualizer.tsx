import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import anime from 'animejs'
import { subscribe } from '@/hooks/ticker'
import { useAudioBands } from '@/hooks/useAudioBands'

// ── Vertex shader (shared by solid + wireframe) ───────────────────────────────
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uQuiet;

  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vDisplace;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x  = x_ * ns.x + ns.yyyy;
    vec4 y  = y_ * ns.x + ns.yyyy;
    vec4 h  = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vNormal   = normal;
    vPosition = position;

    float slowTime = uTime * 0.28;
    float fastTime = uTime * 1.1;

    float base   = snoise(normal * 1.6 + slowTime)           * 0.12;
    float bass   = snoise(normal * 0.9 + slowTime * 0.6)     * uBass   * 0.55;
    float mid    = snoise(normal * 2.4 + fastTime * 0.5)     * uMid    * 0.28;
    float treble = snoise(normal * 5.8 + fastTime)           * uTreble * 0.14;
    float breath = sin(uTime * 0.9) * 0.04                   * uQuiet;

    float displacement = base + bass + mid + treble + breath;
    vDisplace = displacement;

    vec3 displaced = position + normal * displacement;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`


// ── Solid fragment shader ─────────────────────────────────────────────────────
const solidFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;

  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vDisplace;

  void main() {
    vec3 coreColor   = vec3(0.02, 0.08, 0.18);
    vec3 midColor    = vec3(0.00, 0.55, 0.90);
    vec3 hotColor    = vec3(0.72, 0.96, 1.00);
    vec3 accentColor = vec3(0.10, 0.82, 0.70);

    float energy = uBass * 0.5 + uMid * 0.3 + uTreble * 0.2;

    vec3 viewDir = normalize(vec3(0.0, 0.0, 1.0));
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.8);

    float t = clamp((vDisplace * 3.5) + energy * 0.6, 0.0, 1.0);
    vec3 col = mix(coreColor, midColor, t);
    col = mix(col, hotColor, clamp(t * t * 1.4, 0.0, 1.0));
    col = mix(col, accentColor, uBass * 0.35 * fresnel);
    col += hotColor * fresnel * (0.4 + energy * 0.5);

    float scan = sin(vPosition.y * 38.0 + uTime * 2.5) * 0.015;
    col += scan;

    float alpha = 0.82 + fresnel * 0.18;
    gl_FragColor = vec4(col, alpha);
  }
`

// ── Wireframe fragment shader — glowing edges ─────────────────────────────────
const wireFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vDisplace;

  void main() {
    float energy = uBass * 0.6 + uMid * 0.3 + uTreble * 0.1;

    // Cyan base, teal on bass, white flare on high energy
    vec3 lineColor  = vec3(0.00, 0.35, 0.55);
    vec3 bassColor  = vec3(0.00, 0.50, 0.70);
    vec3 flareColor = vec3(0.30, 0.65, 0.85);

    vec3 col = mix(lineColor, bassColor,  uBass * 0.7);
    col      = mix(col,       flareColor, clamp(energy * 1.2 - 0.4, 0.0, 1.0));

    // Pulse brightness with time + bass
    float pulse = 0.75 + 0.25 * sin(uTime * 3.0 + vDisplace * 8.0) + uBass * 0.3;
    col *= pulse;

    gl_FragColor = vec4(col, uOpacity);
  }
`

// ── Component ─────────────────────────────────────────────────────────────────
interface BlobVisualizerProps {
  wireframe?: boolean
}

export function BlobVisualizer({ wireframe = false }: BlobVisualizerProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const getBands = useAudioBands()
  const sceneRef = useRef<{
    solidMesh:    THREE.Mesh
    wireMesh:     THREE.Mesh
    uniforms:     Record<string, THREE.IUniform>
    wireUniforms: Record<string, THREE.IUniform>
  } | null>(null)

  // ── Cross-fade when wireframe prop changes ──────────────────────────────────
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return

    const { solidMesh, wireMesh } = s
    const proxy = { solidOp: (solidMesh.material as THREE.ShaderMaterial).opacity ?? 1,
                    wireOp:  s.wireUniforms.uOpacity.value }

    anime.remove(proxy)

    if (wireframe) {
      wireMesh.visible  = true
      solidMesh.visible = true
      anime({
        targets: proxy,
        solidOp: 0,
        wireOp:  1,
        duration: 600,
        easing: 'easeInOutQuad',
        update() {
          ;(solidMesh.material as THREE.ShaderMaterial).opacity = proxy.solidOp
          s.wireUniforms.uOpacity.value = proxy.wireOp
        },
        complete() { solidMesh.visible = false },
      })
    } else {
      solidMesh.visible = true
      wireMesh.visible  = true
      anime({
        targets: proxy,
        solidOp: 1,
        wireOp:  0,
        duration: 600,
        easing: 'easeInOutQuad',
        update() {
          ;(solidMesh.material as THREE.ShaderMaterial).opacity = proxy.solidOp
          s.wireUniforms.uOpacity.value = proxy.wireOp
        },
        complete() { wireMesh.visible = false },
      })
    }
  }, [wireframe])

  // ── Scene setup (runs once) ─────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.1, 100)
    camera.position.z = 4.2

    const renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: true,
      powerPreference: 'high-performance',
      precision: 'highp',
      stencil: false,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)

    // ── Solid blob — detail 32 = 65k verts ──────────────────────────────────
    const uniforms: Record<string, THREE.IUniform> = {
      uTime:   { value: 0 },
      uBass:   { value: 0 },
      uMid:    { value: 0 },
      uTreble: { value: 0 },
      uQuiet:  { value: 1 },
    }

    const solidGeo = new THREE.IcosahedronGeometry(1, 32)
    const solidMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: solidFragmentShader,
      uniforms,
      transparent: true,
      side: THREE.FrontSide,
    })
    const solidMesh = new THREE.Mesh(solidGeo, solidMat)
    scene.add(solidMesh)

    // ── Wireframe mesh — same geometry + shader as solid, rendered as lines ─────
    // Must use a SEPARATE geometry instance (can't share with solid)
    // but same detail level so displacement is identical.
    const wireGeo = new THREE.IcosahedronGeometry(1, 32)
    const wireUniforms: Record<string, THREE.IUniform> = {
      ...Object.fromEntries(Object.entries(uniforms).map(([k, v]) => [k, v])),
      uOpacity: { value: 1 },
    }
    const wireMat = new THREE.ShaderMaterial({
      vertexShader,           // same shader — same noise displacement
      fragmentShader: wireFragmentShader,
      uniforms: wireUniforms,
      transparent: true,
      depthWrite: false,
      wireframe: true,        // render as lines, not triangles
    })
    const wireMesh = new THREE.Mesh(wireGeo, wireMat)
    wireMesh.visible = true
    solidMesh.visible = false
    ;(solidMesh.material as THREE.ShaderMaterial).opacity = 0
    scene.add(wireMesh)

    sceneRef.current = { solidMesh, wireMesh, uniforms, wireUniforms }

    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', onResize)

    // ── Animate via shared ticker ────────────────────────────────────────────
    let sBass = 0, sMid = 0, sTreble = 0, sQuiet = 1

    const unsub = subscribe((elapsed, delta) => {
      const { bass, mid, treble, quiet } = getBands()
      // Delta-time lerp factors — frame-rate independent
      const lf  = 1 - Math.pow(1 - 0.12, delta * 60)
      const mf  = 1 - Math.pow(1 - 0.18, delta * 60)
      const tf  = 1 - Math.pow(1 - 0.22, delta * 60)
      const qf  = 1 - Math.pow(1 - 0.08, delta * 60)
      const lerp = (a: number, b: number, f: number) => a + (b - a) * f
      sBass   = lerp(sBass,   bass,   lf)
      sMid    = lerp(sMid,    mid,    mf)
      sTreble = lerp(sTreble, treble, tf)
      sQuiet  = lerp(sQuiet,  quiet,  qf)

      uniforms.uTime.value   = elapsed
      uniforms.uBass.value   = sBass
      uniforms.uMid.value    = sMid
      uniforms.uTreble.value = sTreble
      uniforms.uQuiet.value  = sQuiet

      // Delta-time rotation — consistent speed regardless of frame rate
      const rot  = delta * (0.09 + sBass * 0.36)
      const rotX = delta * (0.048 + sMid  * 0.18)
      const scale = 1 + sBass * 0.18

      solidMesh.rotation.y += rot;  solidMesh.rotation.x += rotX
      wireMesh.rotation.y  += rot;  wireMesh.rotation.x  += rotX
      solidMesh.scale.setScalar(scale)
      wireMesh.scale.setScalar(scale)

      renderer.render(scene, camera)
    })

    return () => {
      unsub()
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      el.removeChild(renderer.domElement)
      solidGeo.dispose()
      solidMat.dispose()
      wireGeo.dispose()
      wireMat.dispose()
    }
  }, [getBands])

  return <div ref={mountRef} className="blob-canvas" />
}

// ── Toggle button ─────────────────────────────────────────────────────────────
interface WireframeToggleProps {
  active: boolean
  onToggle: () => void
}

export function WireframeToggle({ active, onToggle }: WireframeToggleProps) {
  return (
    <button
      className={`wireframe-toggle ${active ? 'wireframe-toggle--active' : ''}`}
      onClick={onToggle}
      title="Toggle wireframe"
    >
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="10,2 18,7 18,13 10,18 2,13 2,7" stroke="currentColor" strokeWidth="1.2" fill="none"/>
        <line x1="10" y1="2"  x2="10" y2="18" stroke="currentColor" strokeWidth="0.6" opacity="0.5"/>
        <line x1="2"  y1="7"  x2="18" y2="13" stroke="currentColor" strokeWidth="0.6" opacity="0.5"/>
        <line x1="2"  y1="13" x2="18" y2="7"  stroke="currentColor" strokeWidth="0.6" opacity="0.5"/>
      </svg>
      <span>{active ? 'SOLID' : 'WIRE'}</span>
    </button>
  )
}
