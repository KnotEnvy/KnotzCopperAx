// Small defocused foreground silhouettes, authored in code at stage load.
// Baked softness avoids a fullscreen DOF pass and never blurs the fighting belt.
import * as THREE from 'three';
import { terrainH } from './terrain.js';

function texture(wheel) {
  const sharp = document.createElement('canvas'); sharp.width = sharp.height = 192;
  const c = sharp.getContext('2d');
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.fillStyle = '#151214';
  c.beginPath(); c.ellipse(96, 162, 75, 13, 0, 0, Math.PI * 2); c.fill();
  if (wheel) {
    c.save(); c.translate(96, 102); c.rotate(-.22); c.scale(1, .74);
    // A missing rim section and snapped spokes distinguish a wrecked wheel.
    c.strokeStyle = '#211a18'; c.lineWidth = 19;
    c.beginPath(); c.arc(0, 0, 65, .32, 5.94); c.stroke();
    c.strokeStyle = '#59402c'; c.lineWidth = 4;
    c.beginPath(); c.arc(-2, -3, 63, .36, 3.8); c.stroke();
    for (let i=0;i<7;i++) {
      const a=i*Math.PI*2/7, r=i===0?35:61;
      c.strokeStyle='#34251e'; c.lineWidth=9;
      c.beginPath(); c.moveTo(0,0); c.lineTo(Math.cos(a)*r,Math.sin(a)*r); c.stroke();
    }
    c.fillStyle='#191619'; c.beginPath(); c.ellipse(0,0,15,13,0,0,7); c.fill(); c.restore();
  } else {
    c.fillStyle='#241d1b'; c.beginPath();
    for (const [x,y] of [[72,163],[81,33],[90,49],[99,23],[112,51],[121,30],[119,163]]) c.lineTo(x,y);
    c.closePath(); c.fill();
    c.strokeStyle='#523b2b'; c.lineWidth=5;
    c.beginPath(); c.moveTo(84,145); c.lineTo(94,54); c.stroke();
    c.strokeStyle='#241a17'; c.lineWidth=13;
    c.beginPath(); c.moveTo(26,147); c.lineTo(156,102); c.stroke();
  }
  const canvas=document.createElement('canvas'); canvas.width=canvas.height=192;
  const out=canvas.getContext('2d'); out.filter='blur(2.8px)'; out.drawImage(sharp,0,0);
  const tex=new THREE.CanvasTexture(canvas); tex.colorSpace=THREE.SRGBColorSpace;
  tex.name=wheel?'s1-defocused-broken-wheel':'s1-defocused-fence-stake';
  return tex;
}

export function buildForeground(ctx) {
  const maps=[texture(true),texture(false)], geometry=new THREE.PlaneGeometry(1,1);
  const materials=maps.map(map=>new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,opacity:.9}));
  materials.forEach((material,i)=>material.addEventListener('dispose',()=>maps[i].dispose()));
  // Lower frame corners of the three locked screens; no collision or actor overlap.
  for(const [x,kind] of [[.3,0],[8.1,1],[19.4,1],[27.8,0],[39.4,0],[47.8,1]]) {
    const mesh=new THREE.Mesh(geometry,materials[kind]);
    mesh.name='softForegroundProp'; mesh.position.set(x,terrainH(x,5.9)+.34,5.9);
    mesh.scale.set(kind===0?1.8:1.3,1.08,1); ctx.group.add(mesh);
  }
}
