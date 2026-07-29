'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Sparkles } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

function NeuralOrb() {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);

  const nodes = useMemo(
    () =>
      Array.from({ length: 28 }, (_, index) => {
        const phi = Math.acos(-1 + (2 * index) / 28);
        const theta = Math.sqrt(28 * Math.PI) * phi;
        return new THREE.Vector3(
          Math.cos(theta) * Math.sin(phi) * 1.5,
          Math.sin(theta) * Math.sin(phi) * 1.5,
          Math.cos(phi) * 1.5,
        );
      }),
    [],
  );

  useFrame(({ clock, pointer }) => {
    const elapsed = clock.getElapsedTime();

    if (groupRef.current) {
      groupRef.current.rotation.y = elapsed * 0.12;
      groupRef.current.rotation.x = THREE.MathUtils.lerp(
        groupRef.current.rotation.x,
        pointer.y * 0.18,
        0.035,
      );
      groupRef.current.rotation.z = THREE.MathUtils.lerp(
        groupRef.current.rotation.z,
        -pointer.x * 0.14,
        0.035,
      );
    }

    if (coreRef.current) {
      const pulse = 1 + Math.sin(elapsed * 1.7) * 0.035;
      coreRef.current.scale.setScalar(pulse);
    }
  });

  return (
    <group ref={groupRef}>
      <Float speed={1.35} rotationIntensity={0.18} floatIntensity={0.35}>
        <mesh ref={coreRef}>
          <icosahedronGeometry args={[0.92, 5]} />
          <meshPhysicalMaterial
            color="#75e8ff"
            emissive="#0788b5"
            emissiveIntensity={1.35}
            roughness={0.18}
            metalness={0.2}
            transmission={0.18}
            transparent
            opacity={0.82}
          />
        </mesh>

        <mesh scale={1.34}>
          <icosahedronGeometry args={[0.92, 2]} />
          <meshBasicMaterial
            color="#8d7bff"
            wireframe
            transparent
            opacity={0.2}
          />
        </mesh>

        {nodes.map((position, index) => (
          <mesh key={index} position={position}>
            <sphereGeometry args={[0.035, 12, 12]} />
            <meshBasicMaterial
              color={index % 3 === 0 ? '#9b8cff' : '#6ee7ff'}
              transparent
              opacity={0.9}
            />
          </mesh>
        ))}
      </Float>

      <Sparkles
        count={90}
        scale={5}
        size={1.45}
        speed={0.22}
        noise={0.75}
      />
    </group>
  );
}

export default function HeroFuturistic() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setReady(true), 180);
    return () => window.clearTimeout(timeout);
  }, []);

  const scrollToWorkspace = () =>
    document
      .getElementById('workspace')
      ?.scrollIntoView({ behavior: 'smooth' });

  return (
    <section className="hero-shell">
      <div className="hero-ambient" aria-hidden="true" />

      <header className="hero-nav">
        <a href="#" className="brand-lockup" aria-label="RAG Assistant home">
          <span className="brand-orb" />
          <span>
            <strong>RAG Assistant</strong>
            <small>Knowledge intelligence</small>
          </span>
        </a>

        <button type="button" className="nav-cta" onClick={scrollToWorkspace}>
          Open workspace
        </button>
      </header>

      <div className="hero-grid">
        <div className={`hero-copy ${ready ? 'hero-ready' : ''}`}>
          <span className="eyebrow">
            <i /> Enterprise intelligence, grounded in your data
          </span>

          <h1>One place to understand everything.</h1>

          <p>
            Connect documents, websites, spreadsheets, images, and databases.
            Ask naturally and receive precise answers with traceable sources.
          </p>

          <div className="hero-actions">
            <button
              type="button"
              className="primary-action"
              onClick={scrollToWorkspace}
            >
              Start exploring <span>→</span>
            </button>

            <span className="trust-note">
              <b>Private by design</b> · Source-backed answers
            </span>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="visual-frame" />

          <Canvas
            camera={{ position: [0, 0, 4.8], fov: 42 }}
            dpr={[1, 1.75]}
            gl={{ antialias: true, alpha: true }}
          >
            <ambientLight intensity={0.65} />
            <pointLight position={[3, 3, 4]} intensity={18} color="#7cecff" />
            <pointLight position={[-3, -2, 2]} intensity={12} color="#8068ff" />
            <NeuralOrb />
          </Canvas>

          <div className="visual-status">
            <span /> Neural index online
          </div>
        </div>
      </div>

      <button
        type="button"
        className="scroll-cue"
        onClick={scrollToWorkspace}
        aria-label="Scroll to workspace"
      >
        <span>Explore workspace</span>
        <b>↓</b>
      </button>
    </section>
  );
}
