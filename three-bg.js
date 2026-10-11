/* ============================================================
   ORACLE — Interactive 3D Background (Three.js)
   ============================================================ */

(function() {
  'use strict';

  if (typeof THREE === 'undefined') {
    console.warn('[3D] Three.js gak ke-load, fallback ke CSS');
    return;
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    console.log('[3D] Reduced motion aktif, skip 3D');
    return;
  }

  // Cek WebGL support
  try {
    const test = document.createElement('canvas');
    const gl = test.getContext('webgl') || test.getContext('experimental-webgl');
    if (!gl) throw new Error('No WebGL');
  } catch (e) {
    console.warn('[3D] WebGL gak support, fallback');
    return;
  }

  // Canvas container
  const canvas = document.createElement('canvas');
  canvas.id = 'three-bg';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none';
  document.body.insertBefore(canvas, document.body.firstChild);

  // Scene setup
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0d14, 0.025);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 0, 18);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Colors
  const COLOR_CYAN = new THREE.Color(0x22d3ee);
  const COLOR_VIOLET = new THREE.Color(0xa855f7);
  const COLOR_INDIGO = new THREE.Color(0x6366f1);

  // ============ CENTRAL ORB ============
  const orbGeo = new THREE.IcosahedronGeometry(3.2, 2);
  const orbMat = new THREE.MeshBasicMaterial({
    color: COLOR_INDIGO,
    wireframe: true,
    transparent: true,
    opacity: 0.35
  });
  const orb = new THREE.Mesh(orbGeo, orbMat);
  scene.add(orb);

  // Inner glow orb
  const glowGeo = new THREE.SphereGeometry(2.4, 32, 32);
  const glowMat = new THREE.MeshBasicMaterial({
    color: COLOR_CYAN,
    transparent: true,
    opacity: 0.08
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  scene.add(glow);

  // ============ RADAR RINGS ============
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const ringGeo = new THREE.RingGeometry(4 + i * 1.4, 4.1 + i * 1.4, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? COLOR_CYAN : COLOR_VIOLET,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.15 - i * 0.02
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2 + (i * 0.3);
    ring.rotation.y = i * 0.5;
    rings.push(ring);
    scene.add(ring);
  }

  // ============ PARTICLE NETWORK ============
  const PARTICLE_COUNT = window.innerWidth < 640 ? 120 : 250;
  const particles = [];
  const particleGroup = new THREE.Group();

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const geo = new THREE.SphereGeometry(0.04 + Math.random() * 0.05, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.5 ? COLOR_CYAN : COLOR_VIOLET,
      transparent: true,
      opacity: 0.4 + Math.random() * 0.5
    });
    const p = new THREE.Mesh(geo, mat);
    const radius = 8 + Math.random() * 15;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    p.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta) * 0.6,
      radius * Math.cos(phi)
    );
    p.userData = {
      basePos: p.position.clone(),
      speed: 0.2 + Math.random() * 0.5,
      offset: Math.random() * Math.PI * 2,
      floatAmp: 0.15 + Math.random() * 0.3
    };
    particles.push(p);
    particleGroup.add(p);
  }
  scene.add(particleGroup);

  // ============ CONNECTION LINES ============
  const lineGeo = new THREE.BufferGeometry();
  const lineMat = new THREE.LineBasicMaterial({
    color: COLOR_CYAN,
    transparent: true,
    opacity: 0.06,
    linewidth: 1
  });
  const linePositions = new Float32Array(PARTICLE_COUNT * 3);
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(lines);

  // ============ DATA STREAMS ============
  const dataStreams = [];
  for (let i = 0; i < 8; i++) {
    const start = new THREE.Vector3(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 40
    );
    const end = new THREE.Vector3(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 40
    );
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({
      color: COLOR_VIOLET,
      transparent: true,
      opacity: 0.08
    });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    dataStreams.push({ line, start, end, progress: Math.random(), speed: 0.3 + Math.random() * 0.7 });
  }

  // ============ STARFIELD (background dots) ============
  const starGeo = new THREE.BufferGeometry();
  const starCount = 400;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 100;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 100;
    starPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.08,
    transparent: true,
    opacity: 0.4
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ============ MOUSE / TOUCH INTERACTION ============
  let mouseX = 0, mouseY = 0;
  let targetX = 0, targetY = 0;

  window.addEventListener('mousemove', e => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  window.addEventListener('touchmove', e => {
    if (e.touches[0]) {
      mouseX = (e.touches[0].clientX / window.innerWidth - 0.5) * 2;
      mouseY = (e.touches[0].clientY / window.innerHeight - 0.5) * 2;
    }
  }, { passive: true });

  // Click ripple effect
  window.addEventListener('click', e => {
    if (e.target.closest('button, input, textarea, .card, .panel, .modal')) return;
    const rippleGeo = new THREE.RingGeometry(0.1, 0.3, 32);
    const rippleMat = new THREE.MeshBasicMaterial({
      color: COLOR_CYAN,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    const ripple = new THREE.Mesh(rippleGeo, rippleMat);
    ripple.position.set(
      (e.clientX / window.innerWidth - 0.5) * 30,
      -(e.clientY / window.innerHeight - 0.5) * 20,
      0
    );
    scene.add(ripple);
    const startTime = Date.now();
    const anim = () => {
      const t = (Date.now() - startTime) / 1000;
      if (t > 1.5) {
        scene.remove(ripple);
        ripple.geometry.dispose();
        ripple.material.dispose();
        return;
      }
      const s = 1 + t * 8;
      ripple.scale.set(s, s, s);
      ripple.material.opacity = 0.8 * (1 - t / 1.5);
      requestAnimationFrame(anim);
    };
    anim();
  });

  // ============ RESIZE ============
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ============ ANIMATION LOOP ============
  const clock = new THREE.Clock();
  let frameCount = 0;

  function animate() {
    requestAnimationFrame(animate);

    const elapsed = clock.getElapsedTime();
    const dt = clock.getDelta();

    // Smooth mouse follow
    targetX += (mouseX - targetX) * 0.03;
    targetY += (mouseY - targetY) * 0.03;

    // Camera parallax
    camera.position.x = targetX * 3;
    camera.position.y = -targetY * 2;
    camera.lookAt(0, 0, 0);

    // Orb rotation
    orb.rotation.x += dt * 0.15;
    orb.rotation.y += dt * 0.2;

    // Glow pulse
    const pulse = 1 + Math.sin(elapsed * 1.5) * 0.08;
    glow.scale.set(pulse, pulse, pulse);

    // Rings rotation
    rings.forEach((ring, i) => {
      ring.rotation.z += dt * (0.1 + i * 0.05);
      ring.rotation.y += dt * 0.08;
    });

    // Particles float
    particles.forEach(p => {
      const d = p.userData;
      p.position.y = d.basePos.y + Math.sin(elapsed * d.speed + d.offset) * d.floatAmp;
      p.position.x = d.basePos.x + Math.cos(elapsed * d.speed * 0.5 + d.offset) * d.floatAmp * 0.5;
    });

    // Update connections every 3 frames (performance)
    frameCount++;
    if (frameCount % 3 === 0) {
      const positions = [];
      const MAX_DIST = 3.5;
      for (let i = 0; i < particles.length; i += 2) {
        const a = particles[i].position;
        for (let j = i + 1; j < Math.min(i + 8, particles.length); j++) {
          const b = particles[j].position;
          const dist = a.distanceTo(b);
          if (dist < MAX_DIST) {
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
      }
      const arr = new Float32Array(positions);
      lineGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      lineGeo.attributes.position.needsUpdate = true;
    }

    // Data streams
    dataStreams.forEach(s => {
      s.progress += dt * s.speed * 0.3;
      if (s.progress > 1) s.progress = 0;
      s.line.material.opacity = 0.05 + Math.sin(s.progress * Math.PI) * 0.1;
    });

    // Stars rotation
    stars.rotation.y += dt * 0.01;

    // Particle group slow rotation
    particleGroup.rotation.y += dt * 0.02;

    renderer.render(scene, camera);
  }

  animate();
  console.log('[3D] Interactive background loaded');
})();

