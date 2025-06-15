const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

const model = "joeddav/xlm-roberta-large-xnli";
const etiquetas = [
  "Satisfacción del cliente",
  "Producto dañado",
  "Producto no disponible",
  "Atención al cliente",
];

// Utilidad para descargar el archivo desde Supabase
async function descargarAudio(url, outputPath) {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios.get(url, { responseType: "stream" });
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

app.post("/audio-clasificar", async (req, res) => {
  const { audioUrl } = req.body;

  if (!audioUrl) {
    return res.status(400).json({ error: "Falta el campo 'audioUrl'" });
  }

  const filePath = path.join(__dirname, "temp_audio.mp3");

  try {
    // Paso 1: Descargar audio
    await descargarAudio(audioUrl, filePath);

    // Paso 2: Transcribir con Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
      language: "es", // mejora la precisión si sabes el idioma
    });

    const texto = transcription.text;

    // Paso 3: Clasificar con Hugging Face
    const clasificacion = await axios.post(
      `https://api-inference.huggingface.co/models/${model}`,
      {
        inputs: texto,
        parameters: {
          candidate_labels: etiquetas,
          multi_label: true,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.API_TOKEN}`,
          Accept: "application/json",
        },
      }
    );

    res.json({
      texto,
      clasificacion: clasificacion.data,
    });

    // Limpieza opcional
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`Servidor iniciado en http://localhost:${PORT}`)
);
