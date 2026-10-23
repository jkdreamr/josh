import type * as T from 'three';
import type { Ball, Player } from './logic.ts';

type Three = typeof import('three');

export type PlayerModel = {
  root: T.Group;
  torso: T.Group;
  racketArm: T.Group;
  racketForearm: T.Group;
  leadArm: T.Group;
  legs: [T.Group, T.Group];
  markers: T.Mesh[];
  trim: T.Mesh[];
  phase: number;
};

const teamColors = ['#f3f0e6', '#26364b'];
const accents = ['#b5223a', '#c9e632', '#f1b858', '#48a38c'];

function capsule(THREE: Three, radius: number, length: number, material: T.Material) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
}

function rod(THREE: Three, a: T.Vector3, b: T.Vector3, radius: number, material: T.Material) {
  const delta = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

export function makePlayer(THREE: Three, seat: number, lite: boolean): PlayerModel {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const skin = new THREE.MeshStandardMaterial({ color: ['#b77b55', '#e4b58d', '#86563e', '#d89e76'][seat % 4], roughness: 0.83 });
  const shirt = new THREE.MeshStandardMaterial({ color: teamColors[seat % 2], roughness: 0.72, metalness: 0.02 });
  const shorts = new THREE.MeshStandardMaterial({ color: ['#142d49', '#a1a39a', '#384344', '#ece8db'][seat % 4], roughness: 0.84 });
  const shoe = new THREE.MeshStandardMaterial({ color: '#e9e7dd', roughness: 0.55 });
  const sole = new THREE.MeshStandardMaterial({ color: '#3a4040', roughness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({ color: accents[seat % accents.length], roughness: 0.53 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: ['#30261f', '#72513c', '#211e20', '#b0a18d'][seat % 4], roughness: 0.91 });
  const dark = new THREE.MeshStandardMaterial({ color: '#172127', roughness: 0.66 });
  const eyes = new THREE.MeshStandardMaterial({ color: '#f2eee2', roughness: 0.55 });
  const racketFrame = new THREE.MeshStandardMaterial({ color: '#242a2a', metalness: 0.65, roughness: 0.29 });
  const grip = new THREE.MeshStandardMaterial({ color: '#d8d2c0', roughness: 0.88 });

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), shorts);
  pelvis.scale.set(1.18, 0.72, 0.82);
  pelvis.position.y = 0.86;
  torso.add(pelvis);
  const trunkProfile = [
    new THREE.Vector2(0.16, 0),
    new THREE.Vector2(0.2, 0.16),
    new THREE.Vector2(0.25, 0.32),
    new THREE.Vector2(0.31, 0.54),
    new THREE.Vector2(0.24, 0.72),
    new THREE.Vector2(0.12, 0.76),
    new THREE.Vector2(0, 0.76),
  ];
  const trunk = new THREE.Mesh(new THREE.LatheGeometry(trunkProfile, 32), shirt);
  trunk.position.y = 0.86;
  torso.add(trunk);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.026, 6, 14), accent);
  collar.position.y = 1.57;
  collar.rotation.x = Math.PI / 2;
  torso.add(collar);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.088, 0.19, 10), skin);
  neck.position.y = 1.62;
  torso.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 14), skin);
  head.scale.set(0.88, 1.12, 0.93);
  head.position.set(0, 1.79, 0.035);
  torso.add(head);
  const headband = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.027, 8, 24), accent);
  headband.position.set(0, 1.82, 0.015);
  headband.rotation.x = Math.PI / 2;
  torso.add(headband);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.144, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMaterial);
  hair.position.set(0, 1.83, 0.02);
  torso.add(hair);
  if (seat % 2 === 1) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), accent);
    cap.position.set(0, 1.86, 0.02);
    torso.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 16, 1, false, 0, Math.PI), accent);
    brim.position.set(0, 1.83, 0.11);
    brim.rotation.x = Math.PI / 2;
    torso.add(brim);
  } else {
    const pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 3, 7), hairMaterial);
    pony.position.set(0.02, 1.67, -0.14);
    pony.rotation.x = -0.35;
    torso.add(pony);
  }
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 8), eyes);
    eye.position.set(side * 0.049, 1.79, 0.155);
    torso.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), dark);
    pupil.position.set(side * 0.049, 1.79, 0.171);
    torso.add(pupil);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), skin);
    ear.scale.set(0.55, 0.9, 0.55);
    ear.position.set(side * 0.13, 1.78, 0.01);
    torso.add(ear);
  }

  const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 0.24, 12), shorts);
  shortsMesh.position.y = 0.83;
  torso.add(shortsMesh);
  const trim: T.Mesh[] = [];
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.58, 0.014), accent);
  stripe.position.set(-0.17, 1.27, 0.243);
  torso.add(stripe);
  trim.push(stripe);

  const legs: [T.Group, T.Group] = [new THREE.Group(), new THREE.Group()];
  for (let index = 0; index < 2; index++) {
    const side = index === 0 ? -1 : 1;
    const upper = new THREE.Group();
    upper.position.set(side * 0.12, 0.76, 0);
    torso.add(upper);
    const upperLeg = capsule(THREE, 0.095, 0.37, shorts);
    upperLeg.position.y = -0.24;
    upper.add(upperLeg);
    const knee = new THREE.Group();
    knee.position.y = -0.48;
    upper.add(knee);
    const lowerLeg = capsule(THREE, 0.067, 0.39, skin);
    lowerLeg.position.y = -0.22;
    knee.add(lowerLeg);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.069, 0.067, 0.13, 9), shoe);
    sock.position.y = -0.44;
    knee.add(sock);
    const foot = capsule(THREE, 0.08, 0.22, shoe);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, -0.49, 0.09);
    knee.add(foot);
    const outsole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, 0.31), sole);
    outsole.position.set(0, -0.59, 0.09);
    knee.add(outsole);
    legs[index] = upper;
  }

  const racketArm = new THREE.Group();
  racketArm.position.set(0.34, 1.43, 0);
  torso.add(racketArm);
  const racketSleeve = capsule(THREE, 0.085, 0.18, shirt);
  racketSleeve.position.set(-0.025, -0.09, 0);
  racketSleeve.rotation.z = -0.2;
  racketArm.add(racketSleeve);
  const upperArm = capsule(THREE, 0.072, 0.32, skin);
  upperArm.position.y = -0.21;
  racketArm.add(upperArm);
  const racketForearm = new THREE.Group();
  racketForearm.position.set(0, -0.4, 0.01);
  racketArm.add(racketForearm);
  const forearm = capsule(THREE, 0.058, 0.31, skin);
  forearm.position.y = -0.2;
  racketForearm.add(forearm);
  const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.062, 9, 8), skin);
  wrist.position.y = -0.4;
  racketForearm.add(wrist);
  const leadArm = new THREE.Group();
  leadArm.position.set(-0.34, 1.43, 0);
  torso.add(leadArm);
  const leadSleeve = capsule(THREE, 0.085, 0.18, shirt);
  leadSleeve.position.set(0.02, -0.09, 0);
  leadSleeve.rotation.z = 0.2;
  leadArm.add(leadSleeve);
  const leadUpper = capsule(THREE, 0.07, 0.32, skin);
  leadUpper.position.set(0, -0.23, 0);
  leadArm.add(leadUpper);
  const leadForearm = capsule(THREE, 0.056, 0.3, skin);
  leadForearm.position.set(0, -0.48, 0.01);
  leadArm.add(leadForearm);
  const racket = new THREE.Group();
  racket.position.set(0.04, -0.48, 0.12);
  racketForearm.add(racket);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.25, 8), grip);
  handle.position.y = -0.13;
  racket.add(handle);
  const throatLeft = new THREE.Vector3(-0.05, -0.08, 0);
  const throatRight = new THREE.Vector3(0.05, -0.08, 0);
  const headLow = new THREE.Vector3(0, 0.06, 0);
  racket.add(rod(THREE, throatLeft, headLow, 0.017, racketFrame));
  racket.add(rod(THREE, throatRight, headLow, 0.017, racketFrame));
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.024, 7, 28), racketFrame);
  frame.scale.y = 1.25;
  frame.position.y = 0.29;
  racket.add(frame);
  const stringCanvas = document.createElement('canvas');
  stringCanvas.width = stringCanvas.height = 256;
  const stringContext = stringCanvas.getContext('2d')!;
  stringContext.strokeStyle = 'rgba(239,239,223,.9)';
  stringContext.lineWidth = 3;
  for (let i = 1; i < 8; i++) {
    const p = i * 256 / 8;
    stringContext.beginPath();
    stringContext.moveTo(p, 0);
    stringContext.lineTo(p, 256);
    stringContext.moveTo(0, p);
    stringContext.lineTo(256, p);
    stringContext.stroke();
  }
  const stringTexture = new THREE.CanvasTexture(stringCanvas);
  stringTexture.colorSpace = THREE.SRGBColorSpace;
  const stringPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.62),
    new THREE.MeshBasicMaterial({ map: stringTexture, transparent: true, alphaTest: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  );
  stringPlane.position.set(0, 0.29, 0.026);
  racket.add(stringPlane);
  if (!lite) {
    for (let i = 0; i < 16; i++) {
      const angle = i / 16 * Math.PI * 2;
      const grommet = new THREE.Mesh(new THREE.SphereGeometry(0.015, 5, 4), grip);
      grommet.position.set(Math.sin(angle) * 0.26, 0.29 + Math.cos(angle) * 0.325, 0.025);
      racket.add(grommet);
    }
  }

  const markers: T.Mesh[] = [];
  const markerMaterial = new THREE.MeshBasicMaterial({ color: seat % 2 === 0 ? '#c9e632' : '#f4f2de', transparent: true, opacity: 0.72, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const marker = new THREE.Mesh(new THREE.CircleGeometry(0.35 + i * 0.17, 40), markerMaterial.clone());
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.028 + i * 0.002;
    marker.visible = false;
    root.add(marker);
    markers.push(marker);
  }
  return { root, torso, racketArm, racketForearm, leadArm, legs, markers, trim, phase: seat * 1.7 };
}

export function updatePlayer(model: PlayerModel, player: Player, ball: Ball, dt: number, human: boolean, x = player.x, z = player.z, ballX = ball.p.x, ballY = ball.p.y) {
  model.root.position.set(x, 0, z);
  model.root.rotation.y = player.facing;
  model.phase += dt * (4.5 + Math.hypot(player.vx, player.vz) * 1.2);
  const running = Math.min(1, Math.hypot(player.vx, player.vz) / 4.2);
  model.torso.position.y = Math.sin(model.phase * 2) * 0.025 * running;
  model.torso.rotation.z = Math.max(-0.14, Math.min(0.14, player.vx * -0.025));
  model.torso.rotation.y = -Math.min(0.22, Math.abs(player.vx) * 0.035);
  model.legs[0].rotation.x = Math.sin(model.phase) * 0.58 * running;
  model.legs[1].rotation.x = Math.sin(model.phase + Math.PI) * 0.58 * running;
  const swing = player.swing > 0 ? Math.sin(Math.min(1, player.swing / 0.48) * Math.PI) : 0;
  const ballSide = Math.sign(ballX - x);
  const localX = Math.max(-1.25, Math.min(1.25, ballX - x));
  const localY = Math.max(-0.7, Math.min(1.4, ballY - 1.4));
  const serve = player.serveToss > 0;
  model.racketArm.rotation.x = -0.12 - localY * 0.22 - swing * 0.78 + (serve ? 0.64 : 0);
  model.racketArm.rotation.y = -0.1 + localX * 0.22 + swing * 0.48;
  model.racketArm.rotation.z = -0.38 - localX * 0.38 + swing * (ballSide > 0 ? 1.2 : 0.42);
  model.racketForearm.rotation.x = -0.2 - swing * 1.05 + (serve ? -0.18 : 0);
  model.racketForearm.rotation.z = -0.18 + swing * 0.65;
  model.leadArm.rotation.x = serve ? -1.05 : Math.sin(model.phase + Math.PI) * 0.35 * running;
  model.leadArm.rotation.y = serve ? -0.15 : 0;
  model.leadArm.rotation.z = serve ? 0.38 : Math.sin(model.phase + Math.PI) * 0.22 * running;
  for (let i = 0; i < model.markers.length; i++) {
    model.markers[i].visible = human;
    const material = model.markers[i].material as T.MeshBasicMaterial;
    material.opacity = 0.54 + 0.12 * Math.sin(model.phase * 0.7 + i * 0.55);
    model.markers[i].scale.setScalar(1 + Math.sin(model.phase + i) * 0.025);
  }
}
