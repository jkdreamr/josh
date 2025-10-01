import * as THREE from 'three';
import { gsap } from 'gsap';

class InteractiveScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private particles: THREE.Points;
  private geometries: THREE.Mesh[] = [];
  private cd: THREE.Group | null = null;
  private mouse = { x: 0, y: 0 };
  private targetRotation = { x: 0, y: 0 };
  private clock = new THREE.Clock();
  private scrollProgress = 0;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0a0a, 8, 20);
    
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.z = 5;

    const canvas = document.getElementById('webgl') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.particles = this.createParticles();
    this.createGeometries();
    this.cd = this.createCD();
    this.setupLights();
    this.setupEventListeners();
    this.animate();
  }

  private createCD(): THREE.Group {
    const cdGroup = new THREE.Group();
    
    // Main CD disc body (polycarbonate)
    const discGeometry = new THREE.CylinderGeometry(1.2, 1.2, 0.12, 128);
    const discMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf5f5f5,
      metalness: 0.1,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      reflectivity: 0.9,
      transmission: 0.1,
      thickness: 0.5,
      side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(discGeometry, discMaterial);
    disc.rotation.x = Math.PI / 2;
    disc.castShadow = true;
    disc.receiveShadow = true;
    
    // Top surface with rainbow holographic effect
    const topGeometry = new THREE.CircleGeometry(1.18, 128);
    const topMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.95,
      roughness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.01,
      iridescence: 1,
      iridescenceIOR: 1.5,
      iridescenceThicknessRange: [200, 1200],
      envMapIntensity: 1.5,
      side: THREE.FrontSide,
    });
    const topDisc = new THREE.Mesh(topGeometry, topMaterial);
    topDisc.position.z = 0.061;
    
    // Bottom surface (data layer - slightly darker)
    const bottomGeometry = new THREE.CircleGeometry(1.18, 128);
    const bottomMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe8e8e8,
      metalness: 0.7,
      roughness: 0.1,
      clearcoat: 0.8,
      side: THREE.FrontSide,
    });
    const bottomDisc = new THREE.Mesh(bottomGeometry, bottomMaterial);
    bottomDisc.position.z = -0.061;
    bottomDisc.rotation.y = Math.PI;
    
    // Center hole
    const holeGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.13, 64);
    const holeMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x1a1a1a,
      metalness: 0.3,
      roughness: 0.7,
    });
    const hole = new THREE.Mesh(holeGeometry, holeMaterial);
    hole.rotation.x = Math.PI / 2;
    
    // Data grooves (concentric circles)
    for (let i = 0; i < 15; i++) {
      const radius = 0.2 + (i * 0.06);
      const grooveGeometry = new THREE.TorusGeometry(radius, 0.002, 8, 128);
      const grooveMaterial = new THREE.MeshStandardMaterial({
        color: 0xd0d0d0,
        metalness: 0.5,
        roughness: 0.3,
        transparent: true,
        opacity: 0.4,
      });
      const groove = new THREE.Mesh(grooveGeometry, grooveMaterial);
      groove.rotation.x = Math.PI / 2;
      groove.position.z = 0.06;
      cdGroup.add(groove);
    }
    
    // Label area (white circle in center)
    const labelGeometry = new THREE.CircleGeometry(0.5, 64);
    const labelMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.1,
      roughness: 0.8,
    });
    const label = new THREE.Mesh(labelGeometry, labelMaterial);
    label.position.z = 0.062;
    
    cdGroup.add(disc);
    cdGroup.add(topDisc);
    cdGroup.add(bottomDisc);
    cdGroup.add(hole);
    cdGroup.add(label);
    
    // Position CD
    cdGroup.position.set(-2, 1, 3);
    cdGroup.rotation.x = 0.2;
    cdGroup.rotation.y = 0.3;
    cdGroup.scale.set(0.8, 0.8, 0.8);
    
    this.scene.add(cdGroup);
    
    // Entrance animation
    gsap.from(cdGroup.position, {
      z: -10,
      x: 5,
      y: -3,
      duration: 2.5,
      ease: 'power3.out',
    });
    
    gsap.from(cdGroup.rotation, {
      x: Math.PI * 3,
      y: Math.PI * 2,
      duration: 2.5,
      ease: 'power2.out',
    });
    
    gsap.from(cdGroup.scale, {
      x: 0,
      y: 0,
      z: 0,
      duration: 2,
      ease: 'back.out(2)',
    });
    
    return cdGroup;
  }

  private createParticles(): THREE.Points {
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 500;
    const positions = new Float32Array(particlesCount * 3);
    const colors = new Float32Array(particlesCount * 3);

    const colorPalette = [
      new THREE.Color(0x1db954), // Spotify green
      new THREE.Color(0x4facfe), // blue
      new THREE.Color(0x667eea), // purple
      new THREE.Color(0xffffff), // white
    ];

    for (let i = 0; i < particlesCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 20;
      positions[i + 1] = (Math.random() - 0.5) * 20;
      positions[i + 2] = (Math.random() - 0.5) * 20;

      const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }

    particlesGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );
    particlesGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(colors, 3)
    );

    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    this.scene.add(particles);
    return particles;
  }

  private createCloud(): THREE.Group {
    const cloud = new THREE.Group();
    
    const cloudMaterial = new THREE.MeshPhongMaterial({
      color: 0x2a2a2a,
      transparent: true,
      opacity: 0.3,
      shininess: 5,
    });

    // Create cloud from multiple spheres
    const sphereCount = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < sphereCount; i++) {
      const size = 0.3 + Math.random() * 0.4;
      const geometry = new THREE.SphereGeometry(size, 16, 16);
      const sphere = new THREE.Mesh(geometry, cloudMaterial);
      
      sphere.position.x = (Math.random() - 0.5) * 1.5;
      sphere.position.y = (Math.random() - 0.5) * 0.8;
      sphere.position.z = (Math.random() - 0.5) * 0.8;
      
      sphere.scale.x = 1 + Math.random() * 0.5;
      sphere.scale.y = 0.8 + Math.random() * 0.3;
      sphere.scale.z = 1 + Math.random() * 0.5;
      
      cloud.add(sphere);
    }
    
    return cloud;
  }

  private createGeometries(): void {
    const cloudColors = [0x2a2a2a, 0x3a3a3a, 0x1a1a1a, 0x4a4a4a];
    
    // Create multiple clouds at different positions
    for (let i = 0; i < 5; i++) {
      const cloud = this.createCloud();
      
      // Random positioning in 3D space
      cloud.position.x = (Math.random() - 0.5) * 15;
      cloud.position.y = (Math.random() - 0.5) * 10;
      cloud.position.z = -5 - Math.random() * 10;
      
      // Random scale
      const scale = 0.8 + Math.random() * 1.2;
      cloud.scale.set(scale, scale, scale);
      
      // Tint the cloud
      const color = cloudColors[i % cloudColors.length];
      cloud.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshPhongMaterial).color.setHex(color);
        }
      });
      
      this.geometries.push(cloud as any);
      this.scene.add(cloud);

      // Animate entrance
      gsap.from(cloud.position, {
        z: -20,
        duration: 3,
        delay: i * 0.3,
        ease: 'power2.out',
      });

      gsap.from(cloud.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: 2,
        delay: i * 0.3,
        ease: 'back.out(1.7)',
      });
    }
  }

  private setupLights(): void {
    // Ambient light for overall scene
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);

    // Main directional light (simulates sun/room light)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);

    // Spotlight on CD for dramatic effect
    const spotLight = new THREE.SpotLight(0xffffff, 1.5);
    spotLight.position.set(-3, 5, 5);
    spotLight.angle = Math.PI / 6;
    spotLight.penumbra = 0.3;
    spotLight.decay = 2;
    spotLight.distance = 20;
    this.scene.add(spotLight);

    // Colored accent lights for atmosphere
    const accentLight1 = new THREE.PointLight(0x1db954, 0.8, 15);
    accentLight1.position.set(-8, 2, 3);
    this.scene.add(accentLight1);

    const accentLight2 = new THREE.PointLight(0x4facfe, 0.6, 15);
    accentLight2.position.set(8, -2, 3);
    this.scene.add(accentLight2);

    // Rim light for CD edge highlighting
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
    rimLight.position.set(-5, 0, -5);
    this.scene.add(rimLight);
  }

  private setupEventListeners(): void {
    window.addEventListener('mousemove', (event) => {
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      this.targetRotation.x = this.mouse.y * 0.5;
      this.targetRotation.y = this.mouse.x * 0.5;
    });

    // Scroll interaction
    window.addEventListener('scroll', () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      this.scrollProgress = window.scrollY / maxScroll;
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Click interaction - spin the CD!
    window.addEventListener('click', () => {
      if (this.cd) {
        gsap.to(this.cd.rotation, {
          z: this.cd.rotation.z + Math.PI * 2,
          duration: 1.5,
          ease: 'power2.out',
        });
      }
      
      this.geometries.forEach((cloud, index) => {
        const currentScale = cloud.scale.x;
        gsap.to(cloud.scale, {
          x: currentScale * 1.2,
          y: currentScale * 1.2,
          z: currentScale * 1.2,
          duration: 0.6,
          yoyo: true,
          repeat: 1,
          delay: index * 0.08,
          ease: 'sine.inOut',
        });
      });
    });
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const elapsedTime = this.clock.getElapsedTime();

    // Rotate particles
    this.particles.rotation.y = elapsedTime * 0.05;
    this.particles.rotation.x = Math.sin(elapsedTime * 0.1) * 0.2;

    // Animate clouds - slow drift
    this.geometries.forEach((cloud, index) => {
      cloud.rotation.y += 0.001;
      
      // Gentle floating motion
      cloud.position.x += Math.sin(elapsedTime * 0.2 + index) * 0.002;
      cloud.position.y += Math.cos(elapsedTime * 0.3 + index) * 0.002;
    });

    // Animate CD based on scroll and mouse
    if (this.cd) {
      // Mouse interaction - tilt CD
      const targetTiltX = this.mouse.y * 0.3;
      const targetTiltY = this.mouse.x * 0.3;
      this.cd.rotation.x += (targetTiltX - this.cd.rotation.x) * 0.05;
      this.cd.rotation.y += (targetTiltY - this.cd.rotation.y) * 0.05;
      
      // Scroll interaction - move CD along a path
      const scrollPath = this.scrollProgress * Math.PI * 2;
      const targetX = Math.sin(scrollPath) * 2;
      const targetY = Math.cos(scrollPath) * 1.5 - 0.5;
      const targetZ = 2 + this.scrollProgress * 3;
      
      this.cd.position.x += (targetX - this.cd.position.x) * 0.05;
      this.cd.position.y += (targetY - this.cd.position.y) * 0.05;
      this.cd.position.z += (targetZ - this.cd.position.z) * 0.05;
      
      // Constant gentle spin
      this.cd.rotation.z += 0.005;
      
      // Scale based on scroll (gets bigger as you scroll)
      const targetScale = 1 + this.scrollProgress * 0.5;
      this.cd.scale.x += (targetScale - this.cd.scale.x) * 0.05;
      this.cd.scale.y += (targetScale - this.cd.scale.y) * 0.05;
      this.cd.scale.z += (targetScale - this.cd.scale.z) * 0.05;
    }

    // Smooth camera movement based on mouse
    this.camera.rotation.x += (this.targetRotation.x - this.camera.rotation.x) * 0.05;
    this.camera.rotation.y += (this.targetRotation.y - this.camera.rotation.y) * 0.05;

    this.renderer.render(this.scene, this.camera);
  };
}

// Initialize scene when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new InteractiveScene();
  });
} else {
  new InteractiveScene();
}
