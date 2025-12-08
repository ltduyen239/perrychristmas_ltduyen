import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

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

// --- 照片配置 ---
const TOTAL_NUMBERED_PHOTOS = 6;
const PHOTO_VERSION = '9'; // 版本号更新
const bodyPhotoPaths = [
  `/photos/top.jpg?v=${PHOTO_VERSION}`,
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `/photos/${i + 1}.jpg?v=${PHOTO_VERSION}`)
];

// --- 视觉配置 ---
const CONFIG = {
  colors: {
    emerald: '#008f4c',
    gold: '#FFD700',
    ribbonRed: '#E53935',
    snow: '#FFFFFF',
    lights: ['#FF3333', '#33FF33', '#3388FF', '#FFD700'],
    borders: ['#FFFBE6', '#F7F1D8', '#F0F4FF', '#FFE6EB', '#E6FFEA', '#E6F7FF'],
    giftColors: ['#C62828', '#1565C0', '#2E7D32', '#EF6C00'],
  },
  counts: {
    foliage: 12000,
    ornaments: 80,
    elements: 150,
    lights: 350
  },
  tree: { height: 22, radius: 9 },
  photos: { body: bodyPhotoPaths }
};

// --- Shader Material ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.2;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 chaosColor = uColor * 0.8;
    vec3 formedColor = uColor * 1.8 + vec3(0.15, 0.15, 0.05);
    vec3 finalColor = mix(chaosColor, formedColor, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h/2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 30 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i*3] = spherePoints[i*3]; positions[i*3+1] = spherePoints[i*3+1]; positions[i*3+2] = spherePoints[i*3+2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i*3] = tx; targetPositions[i*3+1] = ty; targetPositions[i*3+2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      materialRef.current.uProgress = THREE.MathUtils.damp(materialRef.current.uProgress, state === 'FORMED' ? 1 : 0, 1.5, delta);
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

// --- Component: Interactive Photo Ornaments (Thick 3D Frame) ---
const PhotoOrnaments = ({ state, isPinching }: { state: 'CHAOS' | 'FORMED', isPinching: boolean }) => {
  const textures = useTexture(CONFIG.photos.body);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // [修改] 使用 BoxGeometry 增加厚度
  // 边框：宽1.2, 高1.5, 厚0.06
  const borderGeometry = useMemo(() => new THREE.BoxGeometry(1.2, 1.5, 0.06), []);
  // 照片：宽1.0, 高1.0, 厚0.01 (薄片贴在表面)
  const photoGeometry = useMemo(() => new THREE.BoxGeometry(1.0, 1.0, 0.01), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*70, (Math.random()-0.5)*70, (Math.random()-0.5)*70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.8;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      
      return {
        chaosPos, targetPos, 
        scale: Math.random() < 0.2 ? 2.0 : 1.0, 
        textureIndex: i % textures.length,
        borderColor: CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)],
        currentPos: chaosPos.clone(),
        currentRot: new THREE.Euler(0,0,0),
        chaosRot: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI)
      };
    });
  }, [textures, count]);

  useEffect(() => {
    if (isPinching && activeIndex === null && groupRef.current) {
      let minDist = Infinity;
      let closestIdx = -1;
      groupRef.current.children.forEach((child, i) => {
        const dist = child.position.distanceTo(camera.position);
        if (dist < minDist && dist < 45) {
          minDist = dist;
          closestIdx = i;
        }
      });
      if (closestIdx !== -1) setActiveIndex(closestIdx);
    } else if (!isPinching) {
      setActiveIndex(null);
    }
  }, [isPinching, camera]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';

    const targetWorldPos = new THREE.Vector3(0, 0, -12);
    targetWorldPos.applyMatrix4(camera.matrixWorld);
    const targetLocalPos = groupRef.current.worldToLocal(targetWorldPos.clone());

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const isActive = i === activeIndex;

      let targetPosition;
      if (isActive) {
        targetPosition = targetLocalPos;
      } else {
        targetPosition = isFormed ? objData.targetPos : objData.chaosPos;
      }

      objData.currentPos.lerp(targetPosition, delta * (isActive ? 5.0 : 1.0));
      group.position.copy(objData.currentPos);

      if (isActive) {
        group.quaternion.copy(camera.quaternion);
      } else if (isFormed) {
         const lookAtPos = new THREE.Vector3(group.position.x * 2, group.position.y, group.position.z * 2);
         group.lookAt(lookAtPos);
         group.rotation.z += Math.sin(stateObj.clock.elapsedTime + i) * 0.002;
      } else {
         group.rotation.x += delta * 0.5;
         group.rotation.y += delta * 0.5;
      }
      
      const targetScale = isActive ? 3.5 : objData.scale;
      const currentScale = group.scale.x;
      const newScale = THREE.MathUtils.lerp(currentScale, targetScale, delta * 5);
      group.scale.set(newScale, newScale, newScale);
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} rotation={state === 'CHAOS' ? obj.chaosRot : [0,0,0]}>
          {/* 使用 Group 包装，整体偏移，让中心点在照片中心 */}
          <group position={[0, 0, 0]}>
            
            {/* 1. 实体相框 (厚度 0.06) */}
            <mesh geometry={borderGeometry} position={[0, -0.15, 0]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.8} metalness={0.1} />
            </mesh>

            {/* 2. 正面照片 (薄片，位置前移 0.035 = 0.03(框半厚) + 0.005(照片半厚)) */}
            <mesh geometry={photoGeometry} position={[0, 0, 0.035]}>
              <meshStandardMaterial map={textures[obj.textureIndex]} roughness={0.4} emissiveMap={textures[obj.textureIndex]} emissive={0xffffff} emissiveIntensity={0.6} />
            </mesh>

            {/* 3. 背面照片 (可选，为了360度展示，位置后移 -0.035) */}
            <mesh geometry={photoGeometry} position={[0, 0, -0.035]} rotation={[0, Math.PI, 0]}>
              <meshStandardMaterial map={textures[obj.textureIndex]} roughness={0.4} emissiveMap={textures[obj.textureIndex]} emissive={0xffffff} emissiveIntensity={0.6} />
            </mesh>

          </group>
        </group>
      ))}
    </group>
  );
};

// --- Model Components ---
const DetailedGiftBox = ({ color, scale, ...props }: any) => {
  return (
    <group scale={[scale, scale, scale]} {...props}>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.1} />
      </mesh>
      <mesh scale={[1.02, 1.02, 0.15]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={CONFIG.colors.gold} roughness={0.2} metalness={0.8} emissive={CONFIG.colors.gold} emissiveIntensity={0.3} />
      </mesh>
      <mesh scale={[0.15, 1.02, 1.02]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={CONFIG.colors.gold} roughness={0.2} metalness={0.8} emissive={CONFIG.colors.gold} emissiveIntensity={0.3} />
      </mesh>
    </group>
  )
}

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

const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);
  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.9;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const type = Math.floor(Math.random() * 3); 
      const color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)];
      return { 
          type, chaosPos, targetPos, color, scale: 0.5 + Math.random() * 0.5,
          currentPos: chaosPos.clone(), 
          rotationSpeed: { x: Math.random()-0.5, y: Math.random()-0.5, z: Math.random()-0.5 }
      };
    });
  }, []);
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      group.position.copy(objData.currentPos);
      group.rotation.x += delta * objData.rotationSpeed.x;
      group.rotation.y += delta * objData.rotationSpeed.y;
    });
  });
  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i}>
            {obj.type === 0 && <DetailedGiftBox color={obj.color} scale={obj.scale} />}
            {obj.type === 1 && <CandyCane scale={obj.scale * 1.5} rotation={[Math.PI, 0, 0]} />}
            {obj.type === 2 && (
                <mesh scale={[obj.scale*0.6, obj.scale*0.6, obj.scale*0.6]}>
                    <sphereGeometry args={[1, 32, 32]} />
                    <meshStandardMaterial color={obj.color} metalness={0.9} roughness={0.1} envMapIntensity={1} />
                </mesh>
            )}
        </group>
      ))}
    </group>
  );
};

const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*50, (Math.random()-0.5)*50, (Math.random()-0.5)*50);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.2;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      return { chaosPos, targetPos, color, speed: 1 + Math.random() * 2, offset: Math.random() * 10, currentPos: chaosPos.clone() };
    });
  }, []);
  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((mesh: any, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.5);
      mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.offset) + 1) * 0.5 + 0.5;
      mesh.material.emissiveIntensity = isFormed ? intensity * 5 : 0.2;
    });
  });
  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <mesh key={i} geometry={geometry} scale={[0.15, 0.15, 0.15]}>
          <meshStandardMaterial color={obj.color} emissive={obj.color} toneMapped={false} roughness={0.1} metalness={0.1} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
};

const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);
  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? 1.4 : 0.7;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(r*Math.cos(a), r*Math.sin(a)) : shape.lineTo(r*Math.cos(a), r*Math.sin(a));
    }
    shape.closePath();
    return shape;
  }, []);
  const geometry = useMemo(() => new THREE.ExtrudeGeometry(starShape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1 }), [starShape]);
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta;
      const s = state === 'FORMED' ? 1 : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(s,s,s), delta * 2);
    }
  });
  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.5, 0]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={CONFIG.colors.gold} emissive={CONFIG.colors.gold} emissiveIntensity={2} roughness={0} metalness={1} />
      </mesh>
      <pointLight intensity={2} distance={10} color={CONFIG.colors.gold} />
    </group>
  );
};

const Experience = ({ sceneState, rotationSpeed, isPinching }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number, isPinching: boolean }) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current && !isPinching) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={20} maxDistance={100} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED' && !isPinching} autoRotateSpeed={0.5} maxPolarAngle={Math.PI / 1.8} />
      <color attach="background" args={['#00100a']} />
      <fog attach="fog" args={['#00100a', 60, 150]} />
      <Stars radius={100} depth={50} count={6000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />
      <ambientLight intensity={0.7} color="#ffffff" />
      <hemisphereLight intensity={0.5} color="#ffffff" groundColor="#444444" />
      <spotLight position={[50, 50, 50]} angle={0.3} penumbra={1} intensity={150} color={CONFIG.colors.gold} castShadow />
      <pointLight position={[-20, 10, -20]} intensity={40} color="#ffaa00" />
      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
           <PhotoOrnaments state={sceneState} isPinching={isPinching} />
           <ChristmasElements state={sceneState} />
           <FairyLights state={sceneState} />
           <TopStar state={sceneState} />
        </Suspense>
        <Sparkles count={500} scale={40} size={6} speed={0.4} opacity={0.6} color={CONFIG.colors.gold} />
      </group>
      <EffectComposer>
        <Bloom luminanceThreshold={0.55} luminanceSmoothing={0.2} intensity={1.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.0} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
const GestureController = ({ onGesture, onMove, onPinch, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;
    const setup = async () => {
      onStatus("正在初始化 AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          onStatus("AI 就绪: 握拳变树 / OK手势捏合照片");
          predictWebcam();
        }
      } catch (err: any) {
        onStatus(`AI 错误: ${err.message}`);
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
            const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");
            if (ctx && debugMode) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                canvasRef.current.width = videoRef.current.videoWidth; 
                canvasRef.current.height = videoRef.current.videoHeight;
                if (results.landmarks) for (const landmarks of results.landmarks) {
                   const drawingUtils = new DrawingUtils(ctx);
                   drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                   drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
                }
            }

            if (results.gestures.length > 0 && results.landmarks.length > 0) {
              const name = results.gestures[0][0].categoryName;
              const landmarks = results.landmarks[0];
              const wrist = landmarks[0];

              const thumbTip = landmarks[4];
              const indexTip = landmarks[8];
              const pinchDist = Math.sqrt(Math.pow(thumbTip.x - indexTip.x, 2) + Math.pow(thumbTip.y - indexTip.y, 2));

              const middleTip = landmarks[12];
              const ringTip = landmarks[16];
              const pinkyTip = landmarks[20];

              const getDistToWrist = (p: any) => Math.sqrt(Math.pow(p.x - wrist.x, 2) + Math.pow(p.y - wrist.y, 2));
              const avgOtherFingersDist = (getDistToWrist(middleTip) + getDistToWrist(ringTip) + getDistToWrist(pinkyTip)) / 3;

              const FIST_THRESHOLD = 0.25; 
              const PINCH_CONTACT_THRESHOLD = 0.08; 

              let isPinching = false;

              if (name === "Closed_Fist" || avgOtherFingersDist < FIST_THRESHOLD) {
                 onGesture("FORMED");
                 isPinching = false;
                 if (debugMode) onStatus(`状态: 握拳 (Tree)`);
              } 
              else if (pinchDist < PINCH_CONTACT_THRESHOLD) {
                 isPinching = true;
                 if (debugMode) onStatus(`状态: 捏合 (View)`);
              } 
              else if (name === "Open_Palm" || avgOtherFingersDist > 0.4) {
                 onGesture("CHAOS");
                 isPinching = false;
                 if (debugMode) onStatus(`状态: 张开 (Chaos)`);
              }

              onPinch(isPinching);

              const speed = (0.5 - landmarks[0].x) * 0.15;
              onMove(Math.abs(speed) > 0.02 ? speed : 0);

            } else { 
              onMove(0); 
              onPinch(false);
            }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onPinch, onStatus, debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 10, right: 10, width: debugMode ? '200px' : '0px', height: 'auto', zIndex: 100, transform: 'scaleX(-1)', border: debugMode ? '1px solid gold' : 'none' }} />
    </>
  );
};

export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [isPinching, setIsPinching] = useState(false);
  const [aiStatus, setAiStatus] = useState("正在初始化...");
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
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ACESFilmicToneMapping }} shadows>
            <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} isPinching={isPinching} />
        </Canvas>
      </div>

      <GestureController 
        onGesture={setSceneState} 
        onMove={setRotationSpeed} 
        onPinch={setIsPinching}
        onStatus={setAiStatus} 
        debugMode={debugMode} 
      />
 
      <div style={{ position: 'absolute', top: '60px', left: '50%', transform: 'translateX(-50%)', zIndex: 10, textAlign: 'center', pointerEvents: 'none' }}>
        <h1 style={{ fontSize: '48px', fontFamily: 'serif', color: '#FFD700', textShadow: '0 0 30px rgba(255, 215, 0, 0.6)', margin: 0, letterSpacing: '4px' }}>
          Merry Christmas!
        </h1>
        <p style={{ fontSize: '16px', color: 'rgba(255, 215, 0, 0.8)', marginTop: '10px', letterSpacing: '3px', fontFamily: 'serif' }}>
          ✨ Perry & Elva ✨
        </p>
      </div>
      
      {isUiVisible && (
        <>
          <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
            <div style={{ marginBottom: '15px' }}>
              <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Gesture Guide</p>
              <p style={{ fontSize: '14px', color: '#FFD700', margin: 0 }}>👊 握拳: 组合圣诞树</p>
              <p style={{ fontSize: '14px', color: '#FFD700', margin: '5px 0 0' }}>👌 捏合(OK手势): 查看照片</p>
            </div>
          </div>

          <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button onClick={toggleMusic} style={{ padding: '0', backgroundColor: isPlaying ? '#D32F2F' : 'rgba(0,0,0,0.5)', border: '1px solid #D32F2F', color: '#fff', borderRadius: '50%', width: '48px', height: '48px', fontSize: '20px', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
              {isPlaying ? '♪' : '✕'}
            </button>

            <button onClick={toggleFullscreen} style={{ padding: '12px 15px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid #999', color: '#999', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
               全屏
            </button>

            <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
               {debugMode ? '调试开' : '调试关'}
            </button>
            
            <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
               {sceneState === 'CHAOS' ? '组合' : '散开'}
            </button>
          </div>

          <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('错误') ? '#FF0000' : 'rgba(255, 215, 0, 0.6)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
            {aiStatus}
          </div>
        </>
      )}
    </div>
  );
}
