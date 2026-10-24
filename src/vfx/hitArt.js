// Authored contact flame: cubic contours, nested colours and a curled negative-space tip.
// Rasterised once at load; reused by the existing instanced shape draw. No image assets or runtime painting.
import * as THREE from 'three';
let flame;
export function contactFlame() {
  if (flame) return flame;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 768;
  const c = canvas.getContext('2d');
  const path = (d, fill, stroke, width = 0) => {
    const p = new Path2D(d); c.fillStyle = fill; c.fill(p);
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.lineJoin = 'round'; c.stroke(p); }
  };
  // Outer red contour: side flick, hooked crown, forked right tongue, broad ignition root.
  path(`M380 705 C272 733 162 630 183 529 C196 568 230 590 256 570
    C300 525 193 474 245 370 C242 422 313 441 323 392
    C351 319 301 254 363 188 C388 158 408 111 390 64
    C470 90 558 177 498 242 C470 273 433 255 452 225
    C469 249 505 226 479 198 C454 171 421 197 431 232
    C448 290 401 323 423 367 C443 409 479 389 494 355
    C523 292 507 266 562 210 C534 316 652 350 607 445
    C580 502 521 517 541 568 C557 538 609 528 638 485
    C660 602 528 735 380 705 Z`, '#ed4110', '#921707', 12);
  // Orange interior with uneven, curling side edges; leave a substantial red rim.
  path(`M378 682 C281 694 216 627 217 580 C258 616 313 568 302 524
    C289 483 265 451 270 425 C297 468 353 447 356 398
    C365 330 340 290 371 249 C361 328 404 354 389 409
    C375 457 437 475 473 416 C475 465 451 495 487 530
    C516 558 551 549 576 522 C563 606 480 688 378 682 Z`, '#ff9d0c');
  // Yellow combustion core sits at the contact, with tiny ivory kernel and two carved tongues.
  path(`M377 662 C315 671 274 620 282 581 C298 615 340 594 332 553
    C324 514 341 491 356 463 C347 517 385 531 392 491
    C405 451 424 429 438 418 C418 476 445 505 423 545
    C404 579 443 600 476 566 C464 634 421 662 377 662 Z`, '#ffe15d');
  path('M378 649 C347 644 329 620 341 593 C350 613 369 603 369 582 C376 605 400 616 414 596 C417 629 403 648 378 649 Z', '#fff0b0');
  flame = new THREE.CanvasTexture(canvas);
  flame.name = 'contact_flame_bezier';
  flame.minFilter = THREE.LinearMipmapLinearFilter; flame.magFilter = THREE.LinearFilter;
  return flame;
}
