// Medidas das molduras, compartilhadas pelos geradores de modelos e de molduras.
const DPI = 300;
const px = (inches) => Math.round(inches * DPI);
const mm = (millimeters) => Math.round((millimeters / 25.4) * DPI);

// Papel como o driver da Kodak 305 informa (com a sobra da impressão sem borda), em polegadas.
const PAPERS = [
  { label: '10x15', paper: [4.09, 6.22], trim: [4, 6] },
  { label: '15x20', paper: [6.22, 8.11], trim: [6, 8] },
];
const ORIENTATIONS = ['horizontal', 'vertical'];
const SAFE = mm(4);   // textos e logos ficam para dentro desta distância do corte
const BAND = 0.07;    // borda sugerida: 7% do lado menor

// Em pixels: W x H do arquivo; tx, ty, tw, th do corte; band = largura da borda.
function geometry({ paper, trim }, orientation) {
  const turn = (pair) => (orientation === 'horizontal' ? [pair[1], pair[0]] : pair);
  const [W, H] = turn(paper).map(px);
  const [tw, th] = turn(trim).map(px);
  return {
    W, H, tw, th,
    tx: (W - tw) / 2,
    ty: (H - th) / 2,
    band: Math.round(Math.min(tw, th) * BAND),
  };
}

module.exports = { DPI, SAFE, PAPERS, ORIENTATIONS, geometry };
