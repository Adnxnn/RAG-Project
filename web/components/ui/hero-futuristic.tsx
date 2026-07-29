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

function PostProcessing({ strength = 1, threshold = 1 }: { strength?: number; threshold?: number }) {
  const { gl, scene, camera } = useThree();
  const progressRef = useRef<any>({ value: 0 });

  const renderer = useMemo(() => {
    const post = new THREE.PostProcessing(gl as any);
    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomPass = bloom(sceneColor, strength, 0.5, threshold);
    const scanProgress = uniform(0);
    progressRef.current = scanProgress;
    const scanLine = smoothstep(0, float(0.05), abs(uv().y.sub(float(scanProgress.value))));
    const redOverlay = vec3(1, 0, 0).mul(oneMinus(scanLine)).mul(0.4);
    const withScan = mix(sceneColor, add(sceneColor, redOverlay), smoothstep(0.9, 1, oneMinus(scanLine)));
    post.outputNode = withScan.add(bloomPass);
    return post;
  }, [camera, gl, scene, strength, threshold]);

  useFrame(({ clock }) => {
    progressRef.current.value = Math.sin(clock.getElapsedTime() * 0.5) * 0.5 + 0.5;
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
    const displacedTexture = texture(rawMap, uv().add(depthTexture.r.mul(pointerUniform).mul(0.01)));
    const imageUv = vec2(uv().x, uv().y);
    const tiling = vec2(120);
    const tiledUv = mod(imageUv.mul(tiling), 2).sub(1);
    const brightness = mx_cell_noise_float(imageUv.mul(tiling).div(2));
    const dot = smoothstep(0.5, 0.49, float(tiledUv.length())).mul(brightness);
    const flow = oneMinus(smoothstep(0, 0.02, abs(depthTexture.sub(progressUniform))));
    const mask = dot.mul(flow).mul(vec3(10, 0, 0));
    const material = new THREE.MeshBasicNodeMaterial({
      colorNode: blendScreen(displacedTexture, mask),
      transparent: true,
      opacity: 0,
    });
    return { material, pointerUniform, progressUniform };
  }, [rawMap, depthMap]);

  const [w, h] = useAspect(300, 300);

  useFrame(({ clock, pointer }) => {
    progressUniform.value = Math.sin(clock.getElapsedTime() * 0.5) * 0.5 + 0.5;
    pointerUniform.value = pointer;
    const mat = meshRef.current?.material as any;
    if (mat?.opacity !== undefined) mat.opacity = THREE.MathUtils.lerp(mat.opacity, visible ? 1 : 0, 0.07);
  });

  return (
    <mesh ref={meshRef} scale={[w * 0.4, h * 0.4, 1]} material={material}>
      <planeGeometry />
    </mesh>
  );
}

export default function HeroFuturistic() {
  const titleWords = 'Knowledge Without Limits'.split(' ');
  const subtitle = 'Upload documents, connect links, and ask your enterprise knowledge anything.';
  const [visibleWords, setVisibleWords] = useState(0);
  const [subtitleVisible, setSubtitleVisible] = useState(false);

  useEffect(() => {
    if (visibleWords < titleWords.length) {
      const timeout = window.setTimeout(() => setVisibleWords((value) => value + 1), 520);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => setSubtitleVisible(true), 500);
    return () => window.clearTimeout(timeout);
  }, [titleWords.length, visibleWords]);

  const scrollToWorkspace = () => document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <section className="relative h-svh min-h-[640px] overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 z-[60] flex flex-col items-center justify-center px-6 text-center uppercase">
        <div className="flex flex-wrap justify-center gap-x-3 overflow-hidden text-4xl font-extrabold tracking-tight text-white md:text-6xl xl:text-7xl">
          {titleWords.map((word, index) => (
            <span key={word} className={index < visibleWords ? 'fade-in' : ''} style={{ opacity: index < visibleWords ? undefined : 0 }}>
              {word}
            </span>
          ))}
        </div>
        <p className={`mt-4 max-w-3xl text-xs font-bold normal-case tracking-wide text-white/80 md:text-xl ${subtitleVisible ? 'fade-in-subtitle' : ''}`} style={{ opacity: subtitleVisible ? undefined : 0 }}>
          {subtitle}
        </p>
      </div>

      <button type="button" className="explore-btn" onClick={scrollToWorkspace}>
        Enter workspace
        <span className="explore-arrow" aria-hidden="true">↓</span>
      </button>

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
    </section>
  );
}
