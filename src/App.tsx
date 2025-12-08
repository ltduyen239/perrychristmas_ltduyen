import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import * as random from 'maath/random';
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// --- 背景音乐 Hook ---
const useBackgroundMusic = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    audioRef.current = new Audio('/music.mp3');
    audioRef.current.loop = true;
    audioRef.current.volume = 0.5;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const toggleMusic = () => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  return { isPlaying, toggleMusic };
};

// --- 配置 ---
const TOTAL_NUMBERED_PHOTOS = 6;
const PHOTO_VERSION = 'v3'; 
const bodyPhotoPaths = [
  `/photos/top.jpg?v=${PHOTO_VERSION}`,
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `/photos/${i + 1}.jpg?v=${PHOTO_VERSION}`)
];

const CONFIG = {
  colors: {
    bg: '#000000',
    champagneGold: '#ffd966', 
    deepGreen: '#03180a',     
    accentRed: '#990000',     
    warmLight: '#ffcc77',
    borders: ['#ffd966', '#fff5cc', '#e6c200'], 
    giftColors: ['#C62828', '#1565C0', '#2E7D32', '#EF6C00', '#FFD700'], // 保留原有丰富配色
  },
  counts: {
    foliage: 10000,
    dust: 2000,
    ornaments: 60,
    elements: 100,
    lights: 250
  },
  tree: { height: 26, radius: 10 },
  photos: { body: bodyPhotoPaths }
};

// --- 1. 忽大忽小的粒子材质 (Dust Shader) - 新增 ---
const DustMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.champagneGold), uPixelRatio: 1 },
  // Vertex Shader
  `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aScale;
  attribute float aSpeed;
  varying float vAlpha;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // 呼吸逻辑
    float breathe = 1.0 + 0.5 * sin(uTime * aSpeed + position.x * 10.0);
    gl_PointSize = aScale * breathe * 60.0 * uPixelRatio / -mvPosition.z;
    vAlpha = 0.8 * breathe; 
  }
  `,
  // Fragment Shader
  `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5));
    if (r > 0.5) discard;
    float glow = 1.0 - (r * 2.0);
    glow = pow(glow, 1.5); 
    gl_FragColor = vec4(uColor, vAlpha * glow);
  }
  `
);
extend({ DustMaterial });

// --- 2. 树叶材质 (保留原有逻辑) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.deepGreen), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    float t = cubicInOut(uProgress);
    vec3 noise = vec3(sin(uTime * 0.5 + position.y), cos(uTime * 0.3 + position.z), sin(uTime * 0.5 + position.x)) * 2.0;
    vec3 finalPos = mix(position + noise, aTargetPos, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = (40.0 * (0.5 + aRandom)) / -mvPosition.z;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 col = mix(uColor * 0.2, uColor * 1.5, vMix);
    gl_FragColor = vec4(col, 0.8);
  }`
);
extend({ FoliageMaterial });

// --- 辅助函数 ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); 
  const normY = (y + h/2) / h;
  const r = rBase * (1 - normY) * Math.sqrt(Math.random()); 
  const theta = Math.random() * Math.PI * 2;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- 组件: 忽大忽小的金色星尘 ---
const PulsingDust = () => {
  const materialRef = useRef<any>(null);
  const { positions, scales, speeds } = useMemo(() => {
    const count = CONFIG.counts.dust;
    const pos = new Float32Array(count * 3);
    const sc = new Float32Array(count);
    const sp = new Float32Array(count);
    const pts = random.inSphere(new Float32Array(count * 3), { radius: 40 }) as Float32Array;
    for(let i=0; i<count; i++) {
        pos[i*3] = pts[i*3]; pos[i*3+1] = pts[i*3+1]; pos[i*3+2] = pts[i*3+2];
        sc[i] = Math.random() * 0.5 + 0.2;
        sp[i] = Math.random() * 2.0 + 1.0;
    }
    return { positions: pos, scales: sc, speeds: sp };
  }, []);

  useFrame((stateObj) => {
    if (materialRef.current) {
      materialRef.current.uTime = stateObj.clock.elapsedTime;
      materialRef.current.uPixelRatio = stateObj.viewport.dpr;
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aScale" args={[scales, 1]} />
        <bufferAttribute attach="attributes-aSpeed" args={[speeds, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <dustMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- 组件: 树叶粒子 (保留) ---
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const pos = new Float32Array(count * 3);
    const target = new Float32Array(count * 3);
    const rnd = new Float32Array(count);
    const sphere = random.inSphere(new Float32Array(count * 3), { radius: 35 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      pos[i*3] = sphere[i*3]; pos[i*3+1] = sphere[i*3+1]; pos[i*3+2] = sphere[i*3+2];
      const [tx, ty, tz] = getTreePosition();
      target[i*3] = tx; target[i*3+1] = ty; target[i*3+2] = tz;
      rnd[i] = Math.random();
    }
    return { positions: pos, targetPositions: target, randoms: rnd };
  }, []);

  useFrame((stateObj, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = stateObj.clock.elapsedTime;
      materialRef.current.uProgress = THREE.MathUtils.damp(materialRef.current.uProgress, state === 'FORMED' ? 1 : 0, 1.0, delta);
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- 组件: 相框 (优化为香槟金+厚度) ---
const PhotoOrnaments = ({ state, isPinching }: { state: 'CHAOS' | 'FORMED', isPinching: boolean }) => {
  const textures = useTexture(CONFIG.photos.body);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // 优化：加厚的相框
  const frameGeometry = useMemo(() => new THREE.BoxGeometry(1.3, 1.6, 0.05), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1.1, 1.1), []); 

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const rScatter = 20 + Math.random() * 20;
      const thetaScatter = Math.random() * Math.PI * 2;
      const yScatter = (Math.random() - 0.5) * 40;
      const chaosPos = new THREE.Vector3(rScatter * Math.cos(thetaScatter), yScatter, rScatter * Math.sin(thetaScatter));

      const h = CONFIG.tree.height; 
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const rTree = (rBase * (1 - (y + h/2)/h)) + 1.5; 
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(rTree * Math.cos(theta), y, rTree * Math.sin(theta));
      
      return {
        chaosPos, targetPos,
        textureIndex: i % textures.length,
        currentPos: chaosPos.clone(),
        rotSpeed: { x: Math.random()*0.5, y: Math.random()*0.5 },
        scale: Math.random() * 0.4 + 0.8
      };
    });
  }, [textures, count]);

  useEffect(() => {
    if (isPinching && activeIndex === null && groupRef.current) {
      let minDist = Infinity; let closestIdx = -1;
      groupRef.current.children.forEach((child, i) => {
        const dist = child.position.distanceTo(camera.position);
        if (dist < minDist && dist < 50) { minDist = dist; closestIdx = i; }
      });
      if (closestIdx !== -1) setActiveIndex(closestIdx);
    } else if (!isPinching) {
      setActiveIndex(null);
    }
  }, [isPinching, camera]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    
    const targetViewPos = new THREE.Vector3(0, 0, -10).applyMatrix4(camera.matrixWorld);
    const localViewPos = groupRef.current.worldToLocal(targetViewPos.clone());

    groupRef.current.children.forEach((group, i) => {
      const d = data[i];
      const isActive = i === activeIndex;

      let target = isActive ? localViewPos : (isFormed ? d.targetPos : d.chaosPos);
      
      d.currentPos.lerp(target, delta * (isActive ? 6.0 : 1.5));
      group.position.copy(d.currentPos);

      if (isActive) {
        group.quaternion.copy(camera.quaternion); 
      } else if (isFormed) {
        group.lookAt(new THREE.Vector3(group.position.x*2, group.position.y, group.position.z*2));
        group.rotation.z = Math.sin(stateObj.clock.elapsedTime + i) * 0.1;
      } else {
        group.rotation.x += d.rotSpeed.x * delta;
        group.rotation.y += d.rotSpeed.y * delta;
      }

      const s = isActive ? 3.5 : d.scale;
      group.scale.lerp(new THREE.Vector3(s,s,s), delta * 4);
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((d, i) => (
        <group key={i}>
          {/* 香槟金金属相框 */}
          <mesh geometry={frameGeometry}>
            <meshStandardMaterial 
              color={CONFIG.colors.champagneGold} 
              metalness={1.0} 
              roughness={0.15} 
              envMapIntensity={2.0} 
            />
          </mesh>
          {/* 照片 (双面) */}
          <mesh geometry={photoGeometry} position={[0, 0.1, 0.03]}>
             <meshBasicMaterial map={textures[d.textureIndex]} />
          </mesh>
          <mesh geometry={photoGeometry} position={[0, 0.1, -0.03]} rotation={[0, Math.PI, 0]}>
             <meshBasicMaterial map={textures[d.textureIndex]} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// --- 组件: 金色彩灯 (优化颜色) ---
const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.3, 16, 16), []); 

  const data = useMemo(() => {
    // 暖色系调色盘
    const palette = [CONFIG.colors.champagneGold, CONFIG.colors.warmLight, CONFIG.colors.accentRed, '#ff3300'];
    return new Array(count).fill(0).map(() => {
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rTree = (CONFIG.tree.radius * (1 - (y + h/2)/h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      
      const targetPos = new THREE.Vector3(rTree * Math.cos(theta), y, rTree * Math.sin(theta));
      const chaosPos = targetPos.clone().multiplyScalar(4.0); 

      return {
        chaosPos, targetPos,
        color: new THREE.Color(palette[Math.floor(Math.random() * palette.length)]),
        currentPos: chaosPos.clone(),
        blinkSpeed: Math.random() * 3 + 1,
        blinkOffset: Math.random() * 100
      };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const t = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((mesh: any, i) => {
      const d = data[i];
      const target = isFormed ? d.targetPos : d.chaosPos;
      d.currentPos.lerp(target, delta * 2.0);
      mesh.position.copy(d.currentPos);

      const intensity = Math.sin(t * d.blinkSpeed + d.blinkOffset) * 0.5 + 0.5;
      mesh.material.emissiveIntensity = isFormed ? (2.0 + intensity * 4.0) : 0.5;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((d, i) => (
        <mesh key={i} geometry={geometry}>
          <meshStandardMaterial 
            color={d.color} 
            emissive={d.color} 
            toneMapped={false} 
            transparent 
            opacity={0.9} 
          />
        </mesh>
      ))}
    </group>
  );
};

// --- 组件: 礼物盒 (严格保留原版 DetailedGiftBox) ---
const DetailedGiftBox = ({ color, scale, ...props }: any) => {
  return (
    <group scale={[scale, scale, scale]} {...props}>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.1} />
      </mesh>
      <mesh scale={[1.02, 1.02, 0.15]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={CONFIG.colors.champagneGold} roughness={0.2} metalness={0.8} emissive={CONFIG.colors.champagneGold} emissiveIntensity={0.3} />
      </mesh>
      <mesh scale={[0.15, 1.02, 1.02]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={CONFIG.colors.champagneGold} roughness={0.2} metalness={0.8} emissive={CONFIG.colors.champagneGold} emissiveIntensity={0.3} />
      </mesh>
    </group>
  )
}

// --- 组件: 拐杖糖 ---
const CandyCane = ({ scale, ...props }: any) => {
    const curve = useMemo(() => new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 0.5, 0),
        new THREE.Vector3(0, 0.7, 0.2), new THREE.Vector3(0, 0.6, 0.4),
    ]), []);
    return (
        <group scale={[scale, scale, scale]} {...props}>
             <mesh>
                <tubeGeometry args={[curve, 32, 0.08, 8, false]} />
                <meshStandardMaterial color="#FFFFFF" roughness={0.2} metalness={0.1} />
            </mesh>
             {[...Array(5)].map((_, i) => (
                 <mesh key={i} position={[0, -0.4 + i * 0.25, 0]} rotation={[0.2,0,0]}>
                     <torusGeometry args={[0.085, 0.02, 8, 16]} />
                     <meshStandardMaterial color="#FF0000" roughness={0.2} />
                 </mesh>
             ))}
        </group>
    )
}

// --- 组件: 圣诞元素 (集成原版礼物盒) ---
const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const r = (CONFIG.tree.radius * (1 - (y + h/2)/h)) * 0.8;
      const theta = Math.random() * Math.PI * 2;
      
      const targetPos = new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta));
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*50, (Math.random()-0.5)*50, (Math.random()-0.5)*50);
      
      const type = Math.floor(Math.random() * 3); // 0: Gift, 1: Cane, 2: Sphere
      const color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)];

      return { 
          targetPos, chaosPos, color, type, 
          scale: 0.5 + Math.random() * 0.5,
          currentPos: chaosPos.clone(),
          rotationSpeed: { x: Math.random()-0.5, y: Math.random()-0.5 }
      };
    });
  }, []);

  useFrame((_, delta) => {
    if(!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((group, i) => {
      const d = data[i];
      const target = isFormed ? d.targetPos : d.chaosPos;
      d.currentPos.lerp(target, delta * 1.5);
      group.position.copy(d.currentPos);
      group.rotation.x += d.rotationSpeed.x * delta;
      group.rotation.y += d.rotationSpeed.y * delta;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((d, i) => (
        <group key={i}>
            {d.type === 0 && <DetailedGiftBox color={d.color} scale={d.scale} />}
            {d.type === 1 && <CandyCane scale={d.scale * 1.5} rotation={[Math.PI, 0, 0]} />}
            {d.type === 2 && (
                <mesh scale={[d.scale*0.6, d.scale*0.6, d.scale*0.6]}>
                    <sphereGeometry args={[1, 32, 32]} />
                    <meshStandardMaterial color={d.color} metalness={0.9} roughness={0.1} envMapIntensity={1} />
                </mesh>
            )}
        </group>
      ))}
    </group>
  );
};

const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);
  const geo = useMemo(() => new THREE.OctahedronGeometry(1.5, 0), []);
  
  useFrame((_, delta) => {
    if(groupRef.current) {
        groupRef.current.rotation.y += delta;
        const s = state === 'FORMED' ? 1 : 0;
        groupRef.current.scale.lerp(new THREE.Vector3(s,s,s), delta * 2);
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height/2 + 1.5, 0]}>
      <mesh geometry={geo}>
        <meshStandardMaterial 
            color={CONFIG.colors.champagneGold} 
            emissive={CONFIG.colors.champagneGold} 
            emissiveIntensity={3.0} 
            toneMapped={false}
        />
      </mesh>
      <pointLight color={CONFIG.colors.warmLight} intensity={3} distance={20} />
    </group>
  );
}

// --- 4. 混合控制器 (手势 + 鼠标) ---
const GestureController = ({ onGesture, onRotate, onPinch, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isWebcamActive = useRef(false);

  // 鼠标控制逻辑 (当无摄像头或未检测到手时生效)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
        if (!isWebcamActive.current) {
            const x = (e.clientX / window.innerWidth) - 0.5;
            // 鼠标 X 轴位置控制旋转
            if (Math.abs(x) > 0.1) {
                onRotate(x * 0.05);
            } else {
                onRotate(0);
            }
        }
    };
    
    // 键盘辅助
    const handleKeyDown = (e: KeyboardEvent) => {
        if (!isWebcamActive.current) {
            if (e.key === '1') { onGesture('FORMED'); onPinch(false); }
            if (e.key === '2') { onGesture('CHAOS'); onPinch(false); }
            if (e.code === 'Space') { onPinch(true); }
        }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
        if (!isWebcamActive.current) {
            if (e.code === 'Space') { onPinch(false); }
        }
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onRotate, onGesture, onPinch]);

  // MediaPipe 逻辑
  useEffect(() => {
    let handLandmarker: HandLandmarker;
    let requestRef: number;

    const setup = async () => {
      onStatus("INITIALIZING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          onStatus("AI READY: HAND GESTURES ACTIVE");
          isWebcamActive.current = true;
          predict();
        }
      } catch (err: any) {
        onStatus(`AI ERROR / MOUSE MODE: ${err.message}`);
        isWebcamActive.current = false; // Fallback to mouse
      }
    };

    const predict = () => {
      if (handLandmarker && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
            const results = handLandmarker.detectForVideo(videoRef.current, performance.now());
            
            const ctx = canvasRef.current.getContext("2d");
            if (ctx && debugMode) {
               ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
               canvasRef.current.width = videoRef.current.videoWidth; 
               canvasRef.current.height = videoRef.current.videoHeight;
            }

            if (results.landmarks && results.landmarks.length > 0) {
                isWebcamActive.current = true;
                const lm = results.landmarks[0]; 
                
                const wrist = lm[0];
                const tips = [8, 12, 16, 20];
                let spread = 0;
                tips.forEach(idx => {
                    const d = Math.sqrt(Math.pow(lm[idx].x - wrist.x, 2) + Math.pow(lm[idx].y - wrist.y, 2));
                    spread += d;
                });
                spread /= 4; 

                const pinchDist = Math.sqrt(Math.pow(lm[4].x - lm[8].x, 2) + Math.pow(lm[4].y - lm[8].y, 2));

                const THRESHOLD_FIST = 0.25; 
                const THRESHOLD_OPEN = 0.40; 
                const THRESHOLD_PINCH = 0.05; 

                if (pinchDist < THRESHOLD_PINCH) {
                    onPinch(true);
                    if(debugMode) onStatus("GESTURE: PINCH (VIEW)");
                } else {
                    onPinch(false);
                    if (spread < THRESHOLD_FIST) {
                        onGesture('FORMED'); 
                        if(debugMode) onStatus("GESTURE: FIST (TREE)");
                    } else if (spread > THRESHOLD_OPEN) {
                        onGesture('CHAOS'); 
                        if(debugMode) onStatus("GESTURE: OPEN (SCATTER)");
                    }
                }

                const handX = 0.5 - lm[0].x; 
                if (Math.abs(handX) > 0.1) {
                    onRotate(handX * 0.05); 
                } else {
                    onRotate(0);
                }

            } else {
                // 如果没有检测到手，释放控制权给鼠标（这里简单处理为不操作，或保持webcam模式但无输入）
                onRotate(0);
                onPinch(false);
            }
        }
        requestRef = requestAnimationFrame(predict);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onRotate, onPinch, onStatus, debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 10, right: 10, width: debugMode ? '200px' : '0px', height: 'auto', zIndex: 100, transform: 'scaleX(-1)', border: debugMode ? '1px solid gold' : 'none' }} />
    </>
  );
};

// --- 5. 主场景 ---
const Experience = ({ sceneState, manualRotationSpeed, isPinching }: any) => {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((_, delta) => {
    if (groupRef.current && !isPinching) {
        const autoSpeed = sceneState === 'FORMED' ? 0.2 : 0.05;
        groupRef.current.rotation.y += (autoSpeed * delta) + manualRotationSpeed;
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 5, 55]} fov={45} />
      <OrbitControls enablePan={false} enableZoom={true} minDistance={20} maxDistance={100} />

      <color attach="background" args={[CONFIG.colors.bg]} />
      <fog attach="fog" args={[CONFIG.colors.bg, 40, 120]} />

      <Environment preset="city" />
      <ambientLight intensity={0.5} />
      
      <spotLight position={[30, 50, 30]} angle={0.4} penumbra={0.5} intensity={100} color={CONFIG.colors.champagneGold} castShadow />
      <spotLight position={[-30, 20, -10]} angle={0.5} penumbra={1} intensity={50} color={CONFIG.colors.warmLight} />
      
      <group ref={groupRef} position={[0, -8, 0]}>
        <PulsingDust />
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
           <PhotoOrnaments state={sceneState} isPinching={isPinching} />
           <ChristmasElements state={sceneState} />
           <FairyLights state={sceneState} />
           <TopStar state={sceneState} />
        </Suspense>
      </group>

      <EffectComposer>
        <Bloom 
            luminanceThreshold={0.6} 
            luminanceSmoothing={0.3} 
            intensity={1.2} 
            radius={0.6}    
            mipmapBlur 
        />
        <Vignette eskil={false} offset={0.1} darkness={1.1} />
      </EffectComposer>
    </>
  );
};

export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [manualRotationSpeed, setManualRotationSpeed] = useState(0);
  const [isPinching, setIsPinching] = useState(false);
  const [aiStatus, setAiStatus] = useState("AI INIT...");
  const [debugMode, setDebugMode] = useState(false);
  const [isUiVisible, setIsUiVisible] = useState(true);
  const { isPlaying, toggleMusic } = useBackgroundMusic();

  useEffect(() => {
    const handleFullscreenChange = () => setIsUiVisible(!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else if (document.exitFullscreen) document.exitFullscreen();
  };

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ACESFilmicToneMapping }}>
            <Experience sceneState={sceneState} manualRotationSpeed={manualRotationSpeed} isPinching={isPinching} />
        </Canvas>
      </div>

      <GestureController 
        onGesture={setSceneState} 
        onRotate={setManualRotationSpeed} 
        onPinch={setIsPinching}
        onStatus={setAiStatus} 
        debugMode={debugMode} 
      />
 
      {/* 标题 - 保留原样 */}
      <div style={{ position: 'absolute', top: '60px', left: '50%', transform: 'translateX(-50%)', zIndex: 10, textAlign: 'center', pointerEvents: 'none' }}>
        <h1 style={{ fontSize: '48px', fontFamily: 'serif', color: CONFIG.colors.champagneGold, textShadow: '0 0 30px rgba(255, 215, 0, 0.6)', margin: 0, letterSpacing: '4px' }}>
          Merry Christmas!
        </h1>
        <p style={{ fontSize: '16px', color: 'rgba(255, 215, 0, 0.8)', marginTop: '10px', letterSpacing: '3px', fontFamily: 'serif' }}>
          ✨ Perry & Elva ✨
        </p>
      </div>
      
      {isUiVisible && (
        <>
          <div style={{ position: 'absolute', bottom: '40px', left: '40px', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
             <p style={{ color: '#666', fontSize: '12px', letterSpacing: '1px' }}>AI STATUS: <span style={{ color: CONFIG.colors.champagneGold }}>{aiStatus}</span></p>
             
             {/* 鼠标操作指南 */}
             <div style={{ marginTop: '10px', color: '#888', fontSize: '12px' }}>
                <p>🖱️ Mouse Move: Rotate</p>
                <button onClick={() => { setSceneState('FORMED'); setIsPinching(false); }} style={{ pointerEvents: 'auto', background: 'rgba(255,255,255,0.1)', border: '1px solid #555', color: '#fff', marginRight: '5px', cursor: 'pointer' }}>Tree</button>
                <button onClick={() => { setSceneState('CHAOS'); setIsPinching(false); }} style={{ pointerEvents: 'auto', background: 'rgba(255,255,255,0.1)', border: '1px solid #555', color: '#fff', marginRight: '5px', cursor: 'pointer' }}>Scatter</button>
                <button onMouseDown={() => setIsPinching(true)} onMouseUp={() => setIsPinching(false)} onTouchStart={() => setIsPinching(true)} onTouchEnd={() => setIsPinching(false)} style={{ pointerEvents: 'auto', background: CONFIG.colors.champagneGold, border: 'none', color: '#000', cursor: 'pointer', fontWeight: 'bold' }}>Hold to Pinch</button>
             </div>
          </div>

          <div style={{ position: 'absolute', bottom: '40px', right: '40px', zIndex: 10, display: 'flex', gap: '15px', alignItems: 'center' }}>
            <button onClick={toggleMusic} style={{ background: 'none', border: `1px solid ${CONFIG.colors.champagneGold}`, color: CONFIG.colors.champagneGold, borderRadius: '50%', width: '50px', height: '50px', cursor: 'pointer', fontSize: '20px' }}>
              {isPlaying ? '♪' : '✕'}
            </button>
            <button onClick={toggleFullscreen} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '10px 20px', cursor: 'pointer', fontFamily: 'serif' }}>
               FULLSCREEN
            </button>
            <button onClick={() => setDebugMode(!debugMode)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#888', padding: '10px 20px', cursor: 'pointer', fontFamily: 'sans-serif', fontSize: '12px' }}>
               DEBUG
            </button>
          </div>
        </>
      )}
    </div>
  );
}
