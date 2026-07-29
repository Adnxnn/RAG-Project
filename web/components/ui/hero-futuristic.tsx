'use client';

import { Canvas, extend, useFrame, useThree } from '@react-three/fiber';
import { useAspect, useTexture } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import type { Mesh } from 'three';
import {
  abs, add, blendScreen, float, mix, mod, mx_cell_noise_float,
  oneMinus, pass, smoothstep, texture, uniform, uv, vec2, vec3,
} from 'three/tsl';

const TEXTUREMAP = 'https://i.postimg.cc/XYwvXN8D/img-4.png';
const DEPTHMAP = 'https://i.postimg.cc/2SHKQh2q/raw-4.webp';

extend(THREE as any);

function PostProcessing({ strength = 0.85, threshold = 0.9 }: { strength?: number; threshold?: number }) {
  const { gl, scene, camera } = useThree();
  const progressRef = useRef<any>({ value: 0 });

  const renderer = useMemo(() => {
    const post = new THREE.PostProcessing(gl as any);
    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomPass = bloom(sceneColor, strength, 0.45, threshold);
    const scanProgress = uniform(0);
    progressRef.current = scanProgress;
    const scanLine = smoothstep(0, float(0.045), abs(uv().y.sub(float(scanProgress.value))));
    const cyanOverlay = vec3(0.08, 0.82, 1).mul(oneMinus(scanLine)).mul(0.32);
    const withScan = mix(sceneColor, add(sceneColor, cyanOverlay), smoothstep(0.9, 1, oneMinus(scanLine)));
    post.outputNode = withScan.add(bloomPass);
    return post;
  }, [camera, gl, scene, strength, threshold]);

  useFrame(({ clock }) => {
    progressRef.current.value = Math.sin(clock.getElapsedTime() * 0.42) * 0.5 + 0.5;
    renderer.renderAsync();
  }, 1);

  return null;
}

function Scene() {
  const [rawMap, depthMap] = useTexture([TEXTUREMAP, DEPTHMAP]);
  const meshRef = useRef<Mesh>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => setVisible(Boolean(rawMap && depthMap)), [rawMap, depthMap]);

  const { material, pointerUniform, progressUniform } = useMemo(() => {
    const pointerUniform = uniform(new THREE.Vector2(0));
    const progressUniform = uniform(0);
    const depthTexture = texture(depthMap);
    const displacedTexture = texture(rawMap, uv().add(depthTexture.r.mul(pointerUniform).mul(0.008)));
    const imageUv = vec2(uv().x, uv().y);
    const tiling = vec2(120);
    const tiledUv = mod(imageUv.mul(tiling), 2).sub(1);
    const brightness = mx_cell_noise_float(imageUv.mul(tiling).div(2));
    const dot = smoothstep(0.5, 0.49, float(tiledUv.length())).mul(brightness);
    const flow = oneMinus(smoothstep(0, 0.02, abs(depthTexture.sub(progressUniform))));
    const mask = dot.mul(flow).mul(vec3(0.2, 5.2, 8.5));
    const material = new THREE.MeshBasicNodeMaterial({
      colorNode: blendScreen(displacedTexture, mask),
      transparent: true,
      opacity: 0,
    });
    return { material, pointerUniform, progressUniform };
  }, [rawMap, depthMap]);

  const [w, h] = useAspect(300, 300);

  useFrame(({ clock, pointer }) => {
    progressUniform.value = Math.sin(clock.getElapsedTime() * 0.42) * 0.5 + 0.5;
    pointerUniform.value = pointer;
    const mat = meshRef.current?.material as any;
    if (mat?.opacity !== undefined) mat.opacity = THREE.MathUtils.lerp(mat.opacity, visible ? 0.78 : 0, 0.06);
  });

  return (
    <mesh ref={meshRef} scale={[w * 0.38, h * 0.38, 1]} material={material}>
      <planeGeometry />
    </mesh>
  );
}

export default function HeroFuturistic() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setReady(true), 180);
    return () => window.clearTimeout(timeout);
  }, []);

  const scrollToWorkspace = () => document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' });

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
        <button type="button" className="nav-cta" onClick={scrollToWorkspace}>Open workspace</button>
      </header>

      <div className="hero-grid">
        <div className={`hero-copy ${ready ? 'hero-ready' : ''}`}>
          <span className="eyebrow"><i /> Enterprise intelligence, grounded in your data</span>
          <h1>One place to understand everything.</h1>
          <p>
            Connect documents, websites, spreadsheets, images, and databases. Ask naturally and receive precise answers with traceable sources.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-action" onClick={scrollToWorkspace}>Start exploring <span>→</span></button>
            <span className="trust-note"><b>Private by design</b> · Source-backed answers</span>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="visual-frame" />
          <Canvas
            flat
            gl={async (props) => {
              const renderer = new THREE.WebGPURenderer(props as any);
              await renderer.init();
              return renderer as any;
            }}
          >
            <PostProcessing />
            <Scene />
          </Canvas>
          <div className="visual-status"><span /> Neural index online</div>
        </div>
      </div>

      <button type="button" className="scroll-cue" onClick={scrollToWorkspace} aria-label="Scroll to workspace">
        <span>Explore workspace</span>
        <b>↓</b>
      </button>
    </section>
  );
}
