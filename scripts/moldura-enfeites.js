// Enfeites de Natal em SVG, usados pelos geradores de molduras. Para usar, coloque FLAKE e
// HOLLY dentro de <defs> e o SVG com xmlns:xlink.

// Floco de neve de raio 10, centrado na origem.
const FLAKE = `
  <g id="flake" stroke="#fff" stroke-linecap="round" fill="none">
    <path stroke-width="1.6" d="M0 -10V10 M-8.66 -5L8.66 5 M-8.66 5L8.66 -5"/>
    <path stroke-width="1.2" d="M-3 -7.5L0 -5L3 -7.5 M-3 7.5L0 5L3 7.5 M-8 -1.2L-4.3 -2.5L-5 -6.2 M8 1.2L4.3 2.5L5 6.2 M-8 1.2L-4.3 2.5L-5 6.2 M8 -1.2L4.3 -2.5L5 -6.2"/>
  </g>`;

// Azevinho com as folhas para +x e +y e as frutinhas na origem; ~100 de comprimento.
const HOLLY = `
  <g id="holly">
    <g id="leaf">
      <path fill="#1e6b34" d="M4 0 C 20 -20, 55 -24, 100 0 C 55 24, 20 20, 4 0 Z"/>
      <path stroke="#0f4720" stroke-width="2.5" fill="none" d="M8 0 H92"/>
    </g>
    <use xlink:href="#leaf" transform="rotate(90)"/>
    <circle r="11" cx="10" cy="10" fill="#d62828"/>
    <circle r="11" cx="-4" cy="14" fill="#c1121f"/>
    <circle r="11" cx="14" cy="-4" fill="#c1121f"/>
    <circle r="3.5" cx="7" cy="6" fill="#fff" opacity=".7"/>
  </g>`;

const holly = (x, y, angle, length) =>
  `<use xlink:href="#holly" transform="translate(${x} ${y}) rotate(${angle}) scale(${length / 100})"/>`;

const flake = (x, y, radius, opacity = 1) =>
  `<use xlink:href="#flake" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(radius / 10).toFixed(3)})" opacity="${opacity}"/>`;

module.exports = { FLAKE, HOLLY, holly, flake };
