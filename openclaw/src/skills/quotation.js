/**
 * Skill: quotation
 * Calcula el costo de importación a Perú (landed cost Lima).
 *
 * Lógica portada de:
 *   agente-buscador-y-comprador/agents/support/shipping_manager.py
 *   agente-buscador-y-comprador/data/sunat_tariffs.json
 *
 * Fórmula:
 *   CIF = FOB + flete + seguro
 *   Ad Valorem = CIF * tasa (según partida arancelaria)
 *   IGV + IPM = (CIF + Ad Valorem) * 20%
 *   Percepción = (CIF + Ad Valorem + IGV + IPM) * 3.5%
 *   Landed = CIF + impuestos + broker (si > $2000)
 *
 * De minimis: envíos < $200 FOB por courier = sin impuestos
 * Viajero: para productos elegibles < $500 y < 3 unidades
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constantes SUNAT / importación Perú
// ---------------------------------------------------------------------------
const FX_RATE           = 3.80;   // PEN / USD (aproximado)
const IGV_RATE          = 0.16;   // IGV 16%
const IPM_RATE          = 0.02;   // IPM 2%
const PERCEPCION_RATE   = 0.035;  // Percepción 3.5%
const INSURANCE_RATE    = 0.005;  // Seguro 0.5% del FOB
const FREIGHT_PER_KG    = 8.0;    // USD/kg flete aéreo China→Lima estimado
const DEFAULT_WEIGHT_KG = 0.5;    // Peso asumido si no se especifica
const DE_MINIMIS_USD    = 200;    // Sin impuestos si FOB < $200
const BROKER_FEE_USD    = 150;    // Agente aduanero (importación formal > $2000)
const FORMAL_THRESHOLD  = 2000;   // A partir de este monto: importación formal

// ---------------------------------------------------------------------------
// Cargar aranceles SUNAT
// ---------------------------------------------------------------------------
let TARIFFS = [];
try {
  const tariffPath = path.join(__dirname, '..', '..', 'data', 'sunat_tariffs.json');
  TARIFFS = JSON.parse(fs.readFileSync(tariffPath, 'utf8'));
} catch (e) {
  console.warn('[Quotation] No se pudo cargar sunat_tariffs.json:', e.message);
}

/**
 * Busca la partida arancelaria más probable por palabras clave en el título del producto.
 * @param {string} productTitle
 * @returns {object} Datos de la partida (ad_valorem, isc, restriction, allow_traveler, traveler_fee)
 */
function getTariffData(productTitle) {
  const title = (productTitle || '').toLowerCase();

  // Buscar primero por keywords (excluir el fallback "Default")
  for (const entry of TARIFFS) {
    if (!entry.keywords || entry.keywords.length === 0) continue;
    for (const kw of entry.keywords) {
      if (title.includes(kw.toLowerCase())) return entry;
    }
  }

  // Fallback: Default / General
  const fallback = TARIFFS.find(t => t.category === 'Default / General');
  return fallback || { ad_valorem: 0.06, isc: 0.0, restriction: 'NONE', allow_traveler: false };
}

/**
 * Calcula el costo de importación a Lima (landed cost).
 *
 * @param {object} params
 * @param {number} params.fobUsd         - Precio FOB en USD
 * @param {number} [params.weightKg]     - Peso en kg (default 0.5kg)
 * @param {string} [params.productTitle] - Título del producto (para lookup arancelario)
 * @param {number} [params.quantity]     - Cantidad de unidades (default 1)
 * @returns {object} Desglose completo del costo
 */
function calculateImport({ fobUsd, weightKg = DEFAULT_WEIGHT_KG, productTitle = '', quantity = 1 }) {
  const totalFob = fobUsd * quantity;
  const tariff   = getTariffData(productTitle);

  // --- Costos de envío ---
  const freightUsd   = weightKg * quantity * FREIGHT_PER_KG;
  const insuranceUsd = totalFob * INSURANCE_RATE;
  const cifUsd       = totalFob + freightUsd + insuranceUsd;
  const cifPen       = cifUsd * FX_RATE;

  // --- Ruta de importación ---
  const isDeminimis = totalFob < DE_MINIMIS_USD;
  const isFormal    = totalFob > FORMAL_THRESHOLD;

  let adValoremUsd = 0, igvIpmUsd = 0, percepcionUsd = 0, brokerFee = 0;
  let route        = 'courier_deminimis';

  if (!isDeminimis) {
    const adValoremRate = tariff.ad_valorem || 0;
    const adValoremPen  = cifPen * adValoremRate;
    const baseIgvPen    = cifPen + adValoremPen;
    const igvIpmPen     = baseIgvPen * (IGV_RATE + IPM_RATE);
    const percepcionPen = (baseIgvPen + igvIpmPen) * PERCEPCION_RATE;

    adValoremUsd  = adValoremPen / FX_RATE;
    igvIpmUsd     = igvIpmPen    / FX_RATE;
    percepcionUsd = percepcionPen / FX_RATE;
    route         = 'courier_taxed';
  }

  if (isFormal) {
    brokerFee = BROKER_FEE_USD;
    route     = 'formal';
  }

  let totalLandedUsd = cifUsd + adValoremUsd + igvIpmUsd + percepcionUsd + brokerFee;
  let travelerFeeUsd = 0;

  // --- Ruta viajero (si es más barata) ---
  const isTravelerEligible =
    tariff.allow_traveler &&
    weightKg * quantity < 10 &&
    totalFob < 500 &&
    quantity <= 3;

  if (isTravelerEligible) {
    travelerFeeUsd = tariff.traveler_fee || 70;
    const travelerTotal = totalFob + travelerFeeUsd;
    if (travelerTotal < totalLandedUsd) {
      totalLandedUsd = travelerTotal;
      route          = 'traveler';
      adValoremUsd   = 0;
      igvIpmUsd      = 0;
      percepcionUsd  = 0;
      brokerFee      = 0;
      freightUsd === freightUsd; // keep for display but traveler absorbs it
    }
  }

  return {
    productTitle,
    quantity,
    fobUsd:          round2(totalFob),
    freightUsd:      round2(freightUsd),
    insuranceUsd:    round2(insuranceUsd),
    cifUsd:          round2(cifUsd),
    adValoremUsd:    round2(adValoremUsd),
    igvIpmUsd:       round2(igvIpmUsd),
    percepcionUsd:   round2(percepcionUsd),
    brokerFeeUsd:    round2(brokerFee),
    travelerFeeUsd:  round2(travelerFeeUsd),
    totalTaxesUsd:   round2(adValoremUsd + igvIpmUsd + percepcionUsd),
    totalLandedUsd:  round2(totalLandedUsd),
    totalLandedPen:  round2(totalLandedUsd * FX_RATE),
    isDeminimis,
    isFormal,
    isTravelerEligible,
    route,
    restriction:     tariff.restriction || 'NONE',
    tariffCategory:  tariff.category    || 'General',
    hsCode:          tariff.hs_code     || 'N/A',
    fxRate:          FX_RATE,
  };
}

/**
 * Genera el texto que el avatar dice al presentar una cotización.
 * @param {object} q - Resultado de calculateImport()
 * @returns {string}
 */
function formatQuotationSpeech(q) {
  const prod = q.productTitle ? `${q.productTitle}` : 'este producto';
  const qty  = q.quantity > 1 ? ` (${q.quantity} unidades)` : '';

  if (q.route === 'courier_deminimis') {
    return `${prod}${qty} — FOB $${q.fobUsd} USD. ` +
           `Al ser menos de $200, entra por courier sin impuestos. ` +
           `Costo total en Lima: $${q.totalLandedUsd} USD (S/ ${q.totalLandedPen} soles).`;
  }

  if (q.route === 'traveler') {
    return `${prod}${qty} — FOB $${q.fobUsd} USD. ` +
           `Ruta viajero: fee $${q.travelerFeeUsd}. ` +
           `Total en Lima: $${q.totalLandedUsd} USD (S/ ${q.totalLandedPen} soles).`;
  }

  const taxes = q.totalTaxesUsd > 0
    ? `Impuestos SUNAT: $${q.totalTaxesUsd} USD. `
    : '';

  const restriction = q.restriction !== 'NONE'
    ? `⚠️ Requiere ${q.restriction}. `
    : '';

  return `${prod}${qty} — FOB $${q.fobUsd} USD. ` +
         `Flete+seguro: $${round2(q.freightUsd + q.insuranceUsd)}. ` +
         `${taxes}` +
         `${restriction}` +
         `Costo total en Lima: $${q.totalLandedUsd} USD (S/ ${q.totalLandedPen} soles).`;
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { calculateImport, formatQuotationSpeech, getTariffData };
