const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
require("dotenv").config();
const csv = require("csv-parser");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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

// 📦 Cargar desde CSV con UPSERT
async function insertarDesdeCSV() {
  const csvPath = path.join(__dirname, "../data/arca_data.csv");
  const results = [];
  

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", async () => {
        for (const row of results) {
          const match = row.geometry?.match(/POINT\s*\((-?\d+\.\d+)\s+(-?\d+\.\d+)\)/);
          const lon = match ? parseFloat(match[1]) : null;
          const lat = match ? parseFloat(match[2]) : null;
          
          const punto = {
            nombre: row.nombre,
            coordenadas: lat && lon ? `POINT(${lon} ${lat})` : null,
            nps: Number(row.nps),
            fillfoundrate: parseFloat(row.fillfoundrate),
            damage_rate: parseFloat(row.damage_rate),
            out_of_stock: parseFloat(row.out_of_stock),
          };

          const { error } = await supabase
            .from("puntos_de_venta")
            .upsert(punto, { onConflict: "nombre" });

          if (error) console.error(`❌ Error actualizando ${row.nombre}:`, error);
          else console.log(`✅ Insertado/Actualizado desde CSV: ${row.nombre}`);
        }

        resolve("Carga CSV completada con UPSERT");
      })
      .on("error", reject);
  });
}

// 📦 Cargar desde GeoJSON con UPSERT
async function insertarDesdeGeoJSON() {
  const geojsonPath = path.join(__dirname, "../data/arca_data.geojson");
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf-8"));

  for (const feature of geojson.features) {
    const nombre = feature.properties.nombre;
    const [lon, lat] = feature.geometry.coordinates;

    const punto = {
      nombre,
      coordenadas: `POINT(${lon} ${lat})`,
    };

    const { error } = await supabase
      .from("puntos_de_venta")
      .upsert(punto, { onConflict: "nombre" });

    if (error) console.error(`❌ Error actualizando ${nombre}:`, error);
    else console.log(`✅ Insertado/Actualizado desde GeoJSON: ${nombre}`);
  }

  return "Carga GeoJSON completada con UPSERT";
}

// 🎧 Descargar audio desde Supabase
async function descargarAudio(url, outputPath) {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios.get(url, { responseType: "stream" });
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

// 🎯 Endpoint: Clasificación de audio
app.post("/audio-clasificar", async (req, res) => {
  const { audioUrl } = req.body;

  if (!audioUrl) {
    return res.status(400).json({ error: "Falta el campo 'audioUrl'" });
  }

  const filePath = path.join(__dirname, "temp_audio.mp3");

  try {
    await descargarAudio(audioUrl, filePath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
      language: "es",
    });

    const texto = transcription.text;

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

    fs.unlinkSync(filePath);
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 📍 Endpoint: Insertar puntos desde CSV
app.post("/cargar-csv", async (req, res) => {
  try {
    const msg = await insertarDesdeCSV();
    res.json({ mensaje: msg });
  } catch (error) {
    console.error("Error al cargar CSV:", error);
    res.status(500).json({ error: "Error al cargar puntos desde CSV." });
  }
});

app.post("/cargar-geojson", async (req, res) => {
  try {
    const msg = await insertarDesdeGeoJSON();
    res.json({ mensaje: msg });
  } catch (error) {
    console.error("Error al cargar GeoJSON:", error);
    res.status(500).json({ error: "Error al cargar puntos desde GeoJSON." });
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`🚀 Servidor iniciado en http://localhost:${PORT}`)

);


