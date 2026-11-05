const express = require('express');
const printing = require('../printing');

const router = express.Router();

// Impressora e papéis que o servidor encontrou. Abrir no navegador para conferir a instalação.
router.get('/', async (req, res) => {
  try {
    res.json(await printing.describe());
  } catch (err) {
    console.error('[impressão] não foi possível listar as impressoras:', err.message);
    res.status(500).json({ error: 'Não foi possível listar as impressoras.' });
  }
});

module.exports = router;
