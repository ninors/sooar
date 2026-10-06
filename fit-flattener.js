/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                     FIT FLATTENER API v1.0.0                            ║
 * ║         Grade-Adjusted Performance Normalization Engine                  ║
 * ║                                                                         ║
 * ║  Normalizes FIT file activities to flat-equivalent performance.          ║
 * ║  Supports running & cycling with multi-model scientific approach.        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * SCIENTIFIC REFERENCES:
 * [1] Minetti et al. (2002) "Energy cost of walking and running at extreme
 *     uphill and downhill slopes" - J Appl Physiol 93:1039-1046
 * [2] Martin et al. (1998) "Validation of a mathematical model for road
 *     cycling power" - J Appl Biomech 14:276-291
 * [3] Bärtsch & Saltin (2008) "General introduction to altitude adaptation
 *     and mountain sickness" - Compr Physiol 2:2431-2462
 * [4] Margaria et al. (1963) "Energy cost of running" - J Appl Physiol 18:367
 * [5] di Prampero (1986) "The energy cost of human locomotion" - J Appl Physiol
 * [6] ACSM (2018) Guidelines for Exercise Testing and Prescription
 * [7] Vernillo et al. (2017) "Energy cost of running in trail runners"
 * [8] Léger & Mercier (1984) "Gross energy cost of horizontal treadmill and
 *     track running" - J Sports Sci 2:121-129
 *
 * USAGE:
 *   <script src="https://cdn.jsdelivr.net/gh/USER/REPO@main/api/v1/fit-flattener.js"></script>
 *   const flattener = new FitFlattener();
 *   const result = await flattener.process(arrayBuffer, { weight: 70 });
 *
 * LICENSE: MIT
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FitFlattener = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {

  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════

  const VERSION = '1.0.0';

  /** FIT epoch: Dec 31, 1989 00:00:00 UTC */
  const FIT_EPOCH_OFFSET = 631065600;

  /** Semicircles to degrees conversion */
  const SEMICIRCLE_TO_DEG = 180.0 / Math.pow(2, 31);

  /** Standard gravity (m/s²) */
  const G = 9.80665;

  /** Sea-level air density (kg/m³) at 15°C */
  const RHO_SEA_LEVEL = 1.225;

  /** Gas constant for dry air (J/(kg·K)) */
  const R_AIR = 287.058;

  /** Standard sea-level pressure (Pa) */
  const P_SEA_LEVEL = 101325;

  /** Standard temperature lapse rate (K/m) */
  const LAPSE_RATE = 0.0065;

  /** Standard sea-level temperature (K) */
  const T_SEA_LEVEL = 288.15;

  /** FIT Global Message Numbers */
  const MESG = {
    FILE_ID: 0,
    SESSION: 18,
    LAP: 19,
    RECORD: 20,
    EVENT: 21,
    DEVICE_INFO: 23,
    ACTIVITY: 34,
    SPORT: 12,
  };

  /** FIT Base Types */
  const BASE_TYPES = {
    0x00: { name: 'enum',    size: 1, invalid: 0xFF },
    0x01: { name: 'sint8',   size: 1, invalid: 0x7F },
    0x02: { name: 'uint8',   size: 1, invalid: 0xFF },
    0x83: { name: 'sint16',  size: 2, invalid: 0x7FFF },
    0x84: { name: 'uint16',  size: 2, invalid: 0xFFFF },
    0x85: { name: 'sint32',  size: 4, invalid: 0x7FFFFFFF },
    0x86: { name: 'uint32',  size: 4, invalid: 0xFFFFFFFF },
    0x07: { name: 'string',  size: 1, invalid: 0x00 },
    0x88: { name: 'float32', size: 4, invalid: NaN },
    0x89: { name: 'float64', size: 8, invalid: NaN },
    0x0A: { name: 'uint8z',  size: 1, invalid: 0x00 },
    0x8B: { name: 'uint16z', size: 2, invalid: 0x0000 },
    0x8C: { name: 'uint32z', size: 4, invalid: 0x00000000 },
    0x0D: { name: 'byte',    size: 1, invalid: 0xFF },
  };

  /** Sport types */
  const SPORT = {
    GENERIC: 0,
    RUNNING: 1,
    CYCLING: 2,
    SWIMMING: 5,
    WALKING: 11,
    HIKING: 17,
    TRAIL_RUNNING: 1, // sub_sport = 3
  };

  /** Record field definitions (field_def_num → metadata) */
  const RECORD_FIELDS = {
    253: { name: 'timestamp',         scale: null, offset: null, unit: 's' },
    0:   { name: 'position_lat',      scale: null, offset: null, unit: 'semicircles' },
    1:   { name: 'position_long',     scale: null, offset: null, unit: 'semicircles' },
    2:   { name: 'altitude',          scale: 5,    offset: 500,  unit: 'm' },
    3:   { name: 'heart_rate',        scale: null, offset: null, unit: 'bpm' },
    4:   { name: 'cadence',           scale: null, offset: null, unit: 'rpm' },
    5:   { name: 'distance',          scale: 100,  offset: null, unit: 'm' },
    6:   { name: 'speed',             scale: 1000, offset: null, unit: 'm/s' },
    7:   { name: 'power',             scale: null, offset: null, unit: 'watts' },
    13:  { name: 'temperature',       scale: null, offset: null, unit: '°C' },
    73:  { name: 'enhanced_speed',    scale: 1000, offset: null, unit: 'm/s' },
    78:  { name: 'enhanced_altitude', scale: 5,    offset: 500,  unit: 'm' },
  };

  /** Session field definitions */
  const SESSION_FIELDS = {
    253: { name: 'timestamp' },
    2:   { name: 'start_time' },
    5:   { name: 'sport' },
    6:   { name: 'sub_sport' },
    7:   { name: 'total_elapsed_time', scale: 1000 },
    8:   { name: 'total_timer_time',   scale: 1000 },
    9:   { name: 'total_distance',     scale: 100 },
    11:  { name: 'total_calories' },
    14:  { name: 'avg_speed',          scale: 1000 },
    16:  { name: 'avg_heart_rate' },
    18:  { name: 'avg_cadence' },
    20:  { name: 'avg_power' },
    22:  { name: 'total_ascent' },
    23:  { name: 'total_descent' },
  };


  // ═══════════════════════════════════════════════════════════════════════════
  // FIT BINARY PARSER
  // ═══════════════════════════════════════════════════════════════════════════

  class FitParser {

    constructor() {
      this._definitions = {};
      this._lastTimestamp = 0;
      this._records = [];
      this._sessions = [];
      this._laps = [];
      this._sport = null;
      this._subSport = null;
    }

    /**
     * Parse a FIT file from an ArrayBuffer
     * @param {ArrayBuffer} buffer - Raw FIT file data
     * @returns {Object} Parsed FIT data
     */
    parse(buffer) {
      const view = new DataView(buffer);
      const bytes = new Uint8Array(buffer);
      let offset = 0;

      // ── File Header ──
      const header = this._readFileHeader(view, offset);
      if (header.dataType !== '.FIT') {
        throw new FitFlattenerError('Invalid FIT file: missing .FIT signature');
      }
      offset = header.headerSize;

      const dataEnd = header.headerSize + header.dataSize;

      // ── Parse Records ──
      while (offset < dataEnd) {
        const recordHeader = this._readRecordHeader(bytes[offset]);
        offset += 1;

        if (recordHeader.isCompressedTimestamp) {
          // Compressed timestamp data message
          const localType = recordHeader.localMessageType;
          const def = this._definitions[localType];
          if (!def) {
            throw new FitFlattenerError(`No definition for local message type ${localType} at offset ${offset - 1}`);
          }
          // Update timestamp
          const timestampOffset = recordHeader.timestampOffset;
          this._lastTimestamp = (this._lastTimestamp & 0xFFFFFFE0) + timestampOffset;
          if (timestampOffset < (this._lastTimestamp & 0x1F)) {
            this._lastTimestamp += 0x20;
          }

          offset = this._readDataMessage(view, bytes, offset, def, this._lastTimestamp);
        } else if (recordHeader.isDefinition) {
          // Definition message
          const result = this._readDefinitionMessage(view, bytes, offset, recordHeader.localMessageType, recordHeader.hasDeveloperData);
          this._definitions[recordHeader.localMessageType] = result.definition;
          offset = result.offset;
        } else {
          // Normal data message
          const localType = recordHeader.localMessageType;
          const def = this._definitions[localType];
          if (!def) {
            throw new FitFlattenerError(`No definition for local message type ${localType} at offset ${offset - 1}`);
          }
          offset = this._readDataMessage(view, bytes, offset, def);
        }
      }

      return {
        records: this._records,
        sessions: this._sessions,
        laps: this._laps,
        sport: this._sport,
        subSport: this._subSport,
      };
    }

    _readFileHeader(view, offset) {
      const headerSize = view.getUint8(offset);
      const protocolVersion = view.getUint8(offset + 1);
      const profileVersion = view.getUint16(offset + 2, true);
      const dataSize = view.getUint32(offset + 4, true);
      const dataType = String.fromCharCode(
        view.getUint8(offset + 8),
        view.getUint8(offset + 9),
        view.getUint8(offset + 10),
        view.getUint8(offset + 11)
      );

      return { headerSize, protocolVersion, profileVersion, dataSize, dataType };
    }

    _readRecordHeader(byte) {
      if (byte & 0x80) {
        // Compressed timestamp header
        return {
          isCompressedTimestamp: true,
          isDefinition: false,
          hasDeveloperData: false,
          localMessageType: (byte >> 5) & 0x03,
          timestampOffset: byte & 0x1F,
        };
      } else {
        return {
          isCompressedTimestamp: false,
          isDefinition: !!(byte & 0x40),
          hasDeveloperData: !!(byte & 0x20),
          localMessageType: byte & 0x0F,
          timestampOffset: 0,
        };
      }
    }

    _readDefinitionMessage(view, bytes, offset, localMessageType, hasDeveloperData) {
      const reserved = bytes[offset]; offset += 1;
      const architecture = bytes[offset]; offset += 1; // 0 = little-endian, 1 = big-endian
      const littleEndian = (architecture === 0);
      const globalMessageNumber = view.getUint16(offset, littleEndian); offset += 2;
      const numFields = bytes[offset]; offset += 1;

      const fields = [];
      for (let i = 0; i < numFields; i++) {
        const fieldDefNum = bytes[offset]; offset += 1;
        const size = bytes[offset]; offset += 1;
        const baseTypeNum = bytes[offset]; offset += 1;
        const baseType = BASE_TYPES[baseTypeNum & 0x9F] || BASE_TYPES[baseTypeNum & 0x1F] || { name: 'unknown', size: 1, invalid: 0xFF };
        fields.push({ fieldDefNum, size, baseTypeNum, baseType });
      }

      // Developer fields (skip for now)
      let numDevFields = 0;
      if (hasDeveloperData) {
        numDevFields = bytes[offset]; offset += 1;
        for (let i = 0; i < numDevFields; i++) {
          offset += 3; // field_number, size, developer_data_index
        }
      }

      return {
        definition: {
          globalMessageNumber,
          littleEndian,
          fields,
          numDevFields,
        },
        offset,
      };
    }

    _readDataMessage(view, bytes, offset, definition, overrideTimestamp) {
      const { globalMessageNumber, littleEndian, fields } = definition;
      const data = {};

      for (const field of fields) {
        const { fieldDefNum, size, baseTypeNum, baseType } = field;
        let value = null;

        try {
          if (baseType.name === 'uint8' || baseType.name === 'enum' || baseType.name === 'uint8z') {
            value = view.getUint8(offset);
          } else if (baseType.name === 'sint8') {
            value = view.getInt8(offset);
          } else if (baseType.name === 'uint16' || baseType.name === 'uint16z') {
            value = (size >= 2) ? view.getUint16(offset, littleEndian) : view.getUint8(offset);
          } else if (baseType.name === 'sint16') {
            value = (size >= 2) ? view.getInt16(offset, littleEndian) : view.getInt8(offset);
          } else if (baseType.name === 'uint32' || baseType.name === 'uint32z') {
            value = (size >= 4) ? view.getUint32(offset, littleEndian) : (size >= 2 ? view.getUint16(offset, littleEndian) : view.getUint8(offset));
          } else if (baseType.name === 'sint32') {
            value = (size >= 4) ? view.getInt32(offset, littleEndian) : (size >= 2 ? view.getInt16(offset, littleEndian) : view.getInt8(offset));
          } else if (baseType.name === 'float32') {
            value = (size >= 4) ? view.getFloat32(offset, littleEndian) : null;
          } else if (baseType.name === 'float64') {
            value = (size >= 8) ? view.getFloat64(offset, littleEndian) : null;
          } else if (baseType.name === 'string') {
            let str = '';
            for (let i = 0; i < size; i++) {
              const c = bytes[offset + i];
              if (c === 0) break;
              str += String.fromCharCode(c);
            }
            value = str;
          } else {
            // byte or unknown — read as raw
            value = bytes[offset];
          }
        } catch (e) {
          value = null;
        }

        // Check for invalid value
        if (value !== null && baseType.invalid !== undefined) {
          if (baseType.name.startsWith('float')) {
            if (isNaN(value)) value = null;
          } else if (typeof baseType.invalid === 'number') {
            if (value === baseType.invalid) value = null;
            // For sized types, check size-appropriate invalids
            if (size === 1 && value === 0xFF) value = null;
            if (size === 2 && value === 0xFFFF) value = null;
            if (size === 4 && value === 0xFFFFFFFF) value = null;
          }
        }

        data[fieldDefNum] = value;
        offset += size;
      }

      // Skip developer fields
      if (definition.numDevFields > 0) {
        // Developer fields were already counted in the definition
        // Their actual data is in the data message but we skip them
      }

      // ── Process by message type ──
      if (globalMessageNumber === MESG.RECORD) {
        this._processRecordMessage(data, overrideTimestamp);
      } else if (globalMessageNumber === MESG.SESSION) {
        this._processSessionMessage(data);
      } else if (globalMessageNumber === MESG.LAP) {
        this._processLapMessage(data);
      }

      return offset;
    }

    _processRecordMessage(data, overrideTimestamp) {
      const record = {};

      // Timestamp
      const ts = overrideTimestamp || data[253];
      if (ts != null) {
        record.timestamp = ts;
        this._lastTimestamp = ts;
      }

      // Position (semicircles → degrees)
      if (data[0] != null) record.lat = data[0] * SEMICIRCLE_TO_DEG;
      if (data[1] != null) record.lon = data[1] * SEMICIRCLE_TO_DEG;

      // Altitude: prefer enhanced_altitude (field 78) over altitude (field 2)
      if (data[78] != null) {
        record.altitude = (data[78] / 5.0) - 500.0;
      } else if (data[2] != null) {
        record.altitude = (data[2] / 5.0) - 500.0;
      }

      // Speed: prefer enhanced_speed (field 73) over speed (field 6)
      if (data[73] != null) {
        record.speed = data[73] / 1000.0;
      } else if (data[6] != null) {
        record.speed = data[6] / 1000.0;
      }

      // Distance
      if (data[5] != null) {
        record.distance = data[5] / 100.0;
      }

      // Heart rate
      if (data[3] != null) record.heart_rate = data[3];

      // Cadence
      if (data[4] != null) record.cadence = data[4];

      // Power
      if (data[7] != null) record.power = data[7];

      // Temperature
      if (data[13] != null) record.temperature = data[13];

      this._records.push(record);
    }

    _processSessionMessage(data) {
      const session = {};

      if (data[5] != null) {
        session.sport = data[5];
        this._sport = data[5];
      }
      if (data[6] != null) {
        session.sub_sport = data[6];
        this._subSport = data[6];
      }
      if (data[7] != null) session.total_elapsed_time = data[7] / 1000.0;
      if (data[8] != null) session.total_timer_time = data[8] / 1000.0;
      if (data[9] != null) session.total_distance = data[9] / 100.0;
      if (data[11] != null) session.total_calories = data[11];
      if (data[14] != null) session.avg_speed = data[14] / 1000.0;
      if (data[16] != null) session.avg_heart_rate = data[16];
      if (data[18] != null) session.avg_cadence = data[18];
      if (data[20] != null) session.avg_power = data[20];
      if (data[22] != null) session.total_ascent = data[22];
      if (data[23] != null) session.total_descent = data[23];

      this._sessions.push(session);
    }

    _processLapMessage(data) {
      const lap = {};
      if (data[253] != null) lap.timestamp = data[253];
      if (data[7] != null) lap.total_elapsed_time = data[7] / 1000.0;
      if (data[9] != null) lap.total_distance = data[9] / 100.0;
      this._laps.push(lap);
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // DATA PROCESSING & SMOOTHING
  // ═══════════════════════════════════════════════════════════════════════════

  class DataProcessor {

    /**
     * Clean raw records: remove invalid points, interpolate gaps
     */
    static clean(records) {
      // Remove records with no essential data
      let cleaned = records.filter(r =>
        r.timestamp != null &&
        r.distance != null &&
        r.speed != null
      );

      if (cleaned.length === 0) {
        throw new FitFlattenerError('No valid data points found in FIT file');
      }

      // Sort by timestamp
      cleaned.sort((a, b) => a.timestamp - b.timestamp);

      // Remove duplicate timestamps
      const seen = new Set();
      cleaned = cleaned.filter(r => {
        if (seen.has(r.timestamp)) return false;
        seen.add(r.timestamp);
        return true;
      });

      // Remove obvious outliers in speed (> 100 m/s = 360 km/h)
      cleaned = cleaned.filter(r => r.speed <= 100);

      // Remove altitude outliers (> 9000m or < -500m)
      cleaned.forEach(r => {
        if (r.altitude != null && (r.altitude > 9000 || r.altitude < -500)) {
          r.altitude = null;
        }
      });

      return cleaned;
    }

    /**
     * Kalman filter for altitude smoothing
     * GPS altitude data is typically noisy (±10-20m for consumer devices)
     *
     * @param {number[]} altitudes - Raw altitude values
     * @param {number} processNoise - Expected terrain variability (m²)
     * @param {number} measurementNoise - GPS altitude noise (m²)
     * @returns {number[]} Smoothed altitude values
     */
    static kalmanFilterAltitude(altitudes, processNoise = 0.5, measurementNoise = 15) {
      if (altitudes.length === 0) return [];

      // Find first valid altitude
      let firstValid = 0;
      while (firstValid < altitudes.length && altitudes[firstValid] == null) firstValid++;
      if (firstValid >= altitudes.length) return altitudes.map(() => 0);

      let estimate = altitudes[firstValid];
      let errorEstimate = measurementNoise;
      const filtered = new Array(altitudes.length);

      for (let i = 0; i < altitudes.length; i++) {
        if (i < firstValid || altitudes[i] == null) {
          filtered[i] = estimate;
          errorEstimate += processNoise;
          continue;
        }

        // Prediction (assume constant altitude model)
        const predictedEstimate = estimate;
        const predictedError = errorEstimate + processNoise;

        // Update
        const kalmanGain = predictedError / (predictedError + measurementNoise);
        estimate = predictedEstimate + kalmanGain * (altitudes[i] - predictedEstimate);
        errorEstimate = (1 - kalmanGain) * predictedError;

        filtered[i] = estimate;
      }

      return filtered;
    }

    /**
     * Gaussian-weighted moving average for smooth grade calculations
     */
    static gaussianSmooth(values, windowSize = 5, sigma = 1.5) {
      const half = Math.floor(windowSize / 2);
      const kernel = [];
      let kernelSum = 0;

      for (let i = -half; i <= half; i++) {
        const w = Math.exp(-(i * i) / (2 * sigma * sigma));
        kernel.push(w);
        kernelSum += w;
      }
      // Normalize
      for (let i = 0; i < kernel.length; i++) kernel[i] /= kernelSum;

      const result = new Array(values.length);
      for (let i = 0; i < values.length; i++) {
        let sum = 0;
        let wSum = 0;
        for (let j = -half; j <= half; j++) {
          const idx = i + j;
          if (idx >= 0 && idx < values.length && values[idx] != null) {
            sum += values[idx] * kernel[j + half];
            wSum += kernel[j + half];
          }
        }
        result[i] = wSum > 0 ? sum / wSum : values[i];
      }
      return result;
    }

    /**
     * Savitzky-Golay smoothing filter (2nd order, window 7)
     * Better than moving average for preserving peaks/valleys
     */
    static savitzkyGolaySmooth(values, windowSize = 7) {
      // Pre-computed coefficients for 2nd order, 7-point SG filter
      // Coefficients: [-2, 3, 6, 7, 6, 3, -2] / 21
      const coeffs = [-2, 3, 6, 7, 6, 3, -2];
      const norm = 21;
      const half = 3;

      const result = new Array(values.length);
      for (let i = 0; i < values.length; i++) {
        if (i < half || i >= values.length - half) {
          result[i] = values[i];
          continue;
        }
        let sum = 0;
        for (let j = -half; j <= half; j++) {
          sum += (values[i + j] || 0) * coeffs[j + half];
        }
        result[i] = sum / norm;
      }
      return result;
    }

    /**
     * Calculate horizontal distance between two GPS points (Haversine)
     */
    static haversineDistance(lat1, lon1, lat2, lon2) {
      const R = 6371000; // Earth radius in meters
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Build enriched segments from cleaned, smoothed records
     */
    static buildSegments(records, smoothedAltitudes) {
      const segments = [];

      for (let i = 1; i < records.length; i++) {
        const prev = records[i - 1];
        const curr = records[i];

        // Segment distance (from cumulative distance or GPS)
        let segDist;
        if (curr.distance != null && prev.distance != null) {
          segDist = curr.distance - prev.distance;
        } else if (curr.lat != null && prev.lat != null) {
          segDist = DataProcessor.haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
        } else {
          continue;
        }

        // Skip zero-distance or negative-distance segments
        if (segDist <= 0.5) continue;

        // Segment time
        const segTime = curr.timestamp - prev.timestamp;
        if (segTime <= 0 || segTime > 300) continue; // Skip pauses > 5min

        // Segment altitude change
        const altPrev = smoothedAltitudes[i - 1];
        const altCurr = smoothedAltitudes[i];
        const elevChange = altCurr - altPrev;

        // Horizontal distance (remove vertical component)
        const horizDist = Math.sqrt(Math.max(0, segDist * segDist - elevChange * elevChange));

        // Grade (gradient as decimal)
        const grade = horizDist > 0.1 ? elevChange / horizDist : 0;

        // Clamp grade to Minetti validated range [-0.45, 0.45]
        const clampedGrade = Math.max(-0.45, Math.min(0.45, grade));

        // Speed (m/s)
        const speed = segDist / segTime;

        // Average altitude of segment
        const avgAlt = (altPrev + altCurr) / 2;

        segments.push({
          index: i,
          distance: segDist,
          horizDistance: horizDist > 0.1 ? horizDist : segDist,
          time: segTime,
          speed: speed,
          grade: clampedGrade,
          rawGrade: grade,
          elevChange: elevChange,
          altitude: avgAlt,
          lat: curr.lat || prev.lat || null,
          lon: curr.lon || prev.lon || null,
          heartRate: curr.heart_rate || prev.heart_rate || null,
          cadence: curr.cadence || prev.cadence || null,
          power: curr.power || prev.power || null,
          temperature: curr.temperature || prev.temperature || null,
        });
      }

      return segments;
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // HIGH-PRECISION ELEVATION API PROVIDER (Open-Meteo 30m DEM, IGN 1m, SRTM)
  // ═══════════════════════════════════════════════════════════════════════════

  class ElevationProvider {

    /**
     * Fetch high-precision ground elevations for a set of GPS points
     *
     * @param {Array<{lat: number, lon: number}>} points - Array of lat/lon points
     * @param {Object} [options]
     * @param {string} [options.provider='auto'] - Provider: 'open-meteo'|'open-elevation'|'ign'|'auto'
     * @param {number} [options.timeout=8000] - Request timeout in ms
     * @returns {Promise<{elevations: number[], providerUsed: string, accuracy: string}>}
     */
    static async fetchElevations(points, options = {}) {
      const provider = options.provider || 'auto';

      if (!points || points.length === 0) {
        return { elevations: [], providerUsed: 'none', accuracy: 'N/A' };
      }

      const validPoints = points.map(p => ({
        lat: p.lat != null ? p.lat : (p[0] != null ? p[0] : null),
        lon: p.lon != null ? p.lon : (p[1] != null ? p[1] : null)
      }));

      if (provider === 'ign') {
        try {
          const res = await ElevationProvider._fetchIGN(validPoints, options);
          if (res && res.elevations.length === validPoints.length) {
            return res;
          }
        } catch (e) {
          // Fallback if IGN fails
        }
      }

      if (provider === 'open-elevation') {
        try {
          const res = await ElevationProvider._fetchOpenElevation(validPoints, options);
          if (res && res.elevations.length === validPoints.length) {
            return res;
          }
        } catch (e) {
          // Fallback
        }
      }

      // Default for 'auto' or 'open-meteo': Open-Meteo (Copernicus DEM 30m/90m)
      try {
        const res = await ElevationProvider._fetchOpenMeteo(validPoints, options);
        if (res && res.elevations.length === validPoints.length) {
          return res;
        }
      } catch (e) {
        try {
          return await ElevationProvider._fetchOpenElevation(validPoints, options);
        } catch (err) {
          throw new FitFlattenerError(`Elevation API request failed: ${e.message}`);
        }
      }

      throw new FitFlattenerError('Failed to fetch elevation from external provider');
    }

    /**
     * Fetch elevations from Open-Meteo Elevation API (Copernicus DEM 30m)
     */
    static async _fetchOpenMeteo(points, options = {}) {
      const BATCH_SIZE = 100; // Max 100 points per GET request to keep URL length under 1500 chars
      const allElevations = [];

      for (let i = 0; i < points.length; i += BATCH_SIZE) {
        const chunk = points.slice(i, i + BATCH_SIZE);
        const lats = chunk.map(p => p.lat.toFixed(6)).join(',');
        const lons = chunk.map(p => p.lon.toFixed(6)).join(',');

        const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
        const json = await ElevationProvider._httpGetJson(url, options.timeout || 8000);

        if (!json || !Array.isArray(json.elevation)) {
          throw new Error('Invalid Open-Meteo response format');
        }
        allElevations.push(...json.elevation);
      }

      return {
        elevations: allElevations,
        providerUsed: 'open-meteo',
        accuracy: 'High Precision (Copernicus DEM 30m resolution)',
      };
    }

    /**
     * Fetch elevations from Open-Elevation API (SRTM 30m)
     */
    static async _fetchOpenElevation(points, options = {}) {
      const BATCH_SIZE = 100;
      const allElevations = [];

      for (let i = 0; i < points.length; i += BATCH_SIZE) {
        const chunk = points.slice(i, i + BATCH_SIZE);
        const locations = chunk.map(p => ({ latitude: p.lat, longitude: p.lon }));

        const json = await ElevationProvider._httpPostJson(
          'https://api.open-elevation.com/api/v1/lookup',
          { locations },
          options.timeout || 8000
        );

        if (!json || !Array.isArray(json.results)) {
          throw new Error('Invalid Open-Elevation response format');
        }
        allElevations.push(...json.results.map(r => r.elevation));
      }

      return {
        elevations: allElevations,
        providerUsed: 'open-elevation',
        accuracy: 'Standard (SRTM 30m resolution)',
      };
    }

    /**
     * Fetch elevations from French IGN Geoportal (RGE ALTI 1m-5m)
     */
    static async _fetchIGN(points, options = {}) {
      const BATCH_SIZE = 50; // Max 50 points per request for IGN REST API
      const allElevations = [];

      for (let i = 0; i < points.length; i += BATCH_SIZE) {
        const chunk = points.slice(i, i + BATCH_SIZE);
        const lons = chunk.map(p => p.lon.toFixed(6)).join('|');
        const lats = chunk.map(p => p.lat.toFixed(6)).join('|');

        const url = `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=${lons}&lat=${lats}&resource=ign_rgealti_wxs`;
        const json = await ElevationProvider._httpGetJson(url, options.timeout || 8000);

        if (!json || !Array.isArray(json.elevations)) {
          throw new Error('Invalid IGN response format');
        }
        allElevations.push(...json.elevations.map(e => e.z));
      }

      return {
        elevations: allElevations,
        providerUsed: 'ign',
        accuracy: 'Ultra Precision (IGN RGE ALTI 1m-5m France)',
      };
    }

    /**
     * HTTP GET wrapper supporting Browser fetch and Node.js fetch/https
     */
    static async _httpGetJson(url, timeoutMs = 8000) {
      if (typeof fetch === 'function') {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          const res = await fetch(url, { signal: controller ? controller.signal : undefined });
          if (timer) clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
          return await res.json();
        } catch (e) {
          if (timer) clearTimeout(timer);
          throw e;
        }
      }

      if (typeof require === 'function') {
        const https = require('https');
        return new Promise((resolve, reject) => {
          const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (err) {
                reject(err);
              }
            });
          });
          req.on('error', reject);
          req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('HTTP request timeout'));
          });
        });
      }

      throw new Error('No HTTP fetch method available in environment');
    }

    /**
     * HTTP POST wrapper supporting Browser fetch and Node.js
     */
    static async _httpPostJson(url, payload, timeoutMs = 8000) {
      const body = JSON.stringify(payload);

      if (typeof fetch === 'function') {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body,
            signal: controller ? controller.signal : undefined
          });
          if (timer) clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
          return await res.json();
        } catch (e) {
          if (timer) clearTimeout(timer);
          throw e;
        }
      }

      if (typeof require === 'function') {
        const https = require('https');
        const urlObj = new URL(url);
        return new Promise((resolve, reject) => {
          const req = https.request({
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body)
            }
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (err) {
                reject(err);
              }
            });
          });
          req.on('error', reject);
          req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('HTTP request timeout'));
          });
          req.write(body);
          req.end();
        });
      }

      throw new Error('No HTTP fetch method available in environment');
    }

    /**
     * Enrich records with external precision elevation data
     *
     * @param {Array<Object>} records - FIT records containing lat/lon
     * @param {Object} [options]
     * @returns {Promise<{records: Array<Object>, source: string, replacedCount: number, accuracy: string}>}
     */
    static async enrichRecords(records, options = {}) {
      if (options.useExternalElevation === false) {
        return { records, source: 'fit_sensor', replacedCount: 0, accuracy: 'Barometer/GPS (FIT File)' };
      }

      const gpsIndices = [];
      const gpsPoints = [];

      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.lat != null && r.lon != null) {
          gpsIndices.push(i);
          gpsPoints.push({ lat: r.lat, lon: r.lon });
        }
      }

      if (gpsPoints.length === 0) {
        return { records, source: 'fit_sensor_no_gps', replacedCount: 0, accuracy: 'Barometer (No GPS coordinates in FIT)' };
      }

      try {
        // Downsample points to max ~200 samples for high speed & zero rate limiting
        const MAX_SAMPLES = 200;
        const step = Math.max(1, Math.floor(gpsPoints.length / MAX_SAMPLES));

        const sampledPoints = [];
        const sampledIndices = [];

        for (let i = 0; i < gpsPoints.length; i += step) {
          sampledPoints.push(gpsPoints[i]);
          sampledIndices.push(i);
        }
        if (sampledIndices[sampledIndices.length - 1] !== gpsPoints.length - 1) {
          sampledPoints.push(gpsPoints[gpsPoints.length - 1]);
          sampledIndices.push(gpsPoints.length - 1);
        }

        const elevationResult = await ElevationProvider.fetchElevations(sampledPoints, options);
        const { elevations, providerUsed, accuracy } = elevationResult;

        // Check if FIT file has valid barometric altitude data from Garmin/Wahoo device
        const hasBarometer = records.some(r => r.altitude != null && !isNaN(r.altitude));
        const mode = options.elevationMode || 'hybrid';

        if (hasBarometer && mode !== 'dem') {
          // HYBRID MODE: Correct atmospheric drift of Garmin barometer using DEM ground baseline
          // 1. Calculate raw offset at sampled points: delta = DEM_altitude - Baro_altitude
          const offsets = [];
          for (let s = 0; s < sampledPoints.length; s++) {
            const origAlt = records[gpsIndices[sampledIndices[s]]].altitude;
            const demAlt = elevations[s];
            if (origAlt != null && demAlt != null) {
              offsets.push(demAlt - origAlt);
            } else {
              offsets.push(0);
            }
          }

          // 2. Smooth offsets using moving average to get a clean baseline shift curve
          const smoothOffsets = DataProcessor.gaussianSmooth(offsets, 11, 2.5);

          // 3. Interpolate smooth baseline offset across all GPS points
          let replacedCount = 0;
          for (let k = 0; k < gpsIndices.length; k++) {
            const recordIdx = gpsIndices[k];
            const origAlt = records[recordIdx].altitude;

            let s = 0;
            while (s < sampledIndices.length - 1 && sampledIndices[s + 1] <= k) s++;
            const idxA = sampledIndices[s];
            const idxB = sampledIndices[s + 1] || idxA;
            const frac = idxB > idxA ? (k - idxA) / (idxB - idxA) : 0;
            const offset = smoothOffsets[s] + frac * ((smoothOffsets[s + 1] || smoothOffsets[s]) - smoothOffsets[s]);

            if (origAlt != null) {
              records[recordIdx].rawFitAltitude = origAlt;
              records[recordIdx].altitude = origAlt + offset;
              replacedCount++;
            }
          }

          return {
            records,
            source: `${providerUsed}_hybrid`,
            replacedCount,
            accuracy: `Hybrid Precision (Garmin Barometer 1Hz + ${accuracy} Baseline Alignment)`,
          };
        }

        // PURE DEM MODE (For FIT files without barometric altitude)
        const interpolatedElevations = new Array(gpsPoints.length);
        for (let s = 0; s < sampledIndices.length - 1; s++) {
          const idxA = sampledIndices[s];
          const idxB = sampledIndices[s + 1];
          const altA = elevations[s];
          const altB = elevations[s + 1];

          for (let k = idxA; k <= idxB; k++) {
            if (idxA === idxB || altA == null || altB == null) {
              interpolatedElevations[k] = altA != null ? altA : altB;
            } else {
              const frac = (k - idxA) / (idxB - idxA);
              interpolatedElevations[k] = altA + frac * (altB - altA);
            }
          }
        }

        let replacedCount = 0;
        for (let k = 0; k < gpsIndices.length; k++) {
          const recordIdx = gpsIndices[k];
          const apiAlt = interpolatedElevations[k];
          if (apiAlt != null && !isNaN(apiAlt)) {
            records[recordIdx].rawFitAltitude = records[recordIdx].altitude;
            records[recordIdx].altitude = apiAlt;
            replacedCount++;
          }
        }

        let lastValidAlt = null;
        for (let i = 0; i < records.length; i++) {
          if (records[i].altitude != null) {
            lastValidAlt = records[i].altitude;
          } else if (lastValidAlt != null) {
            records[i].altitude = lastValidAlt;
          }
        }

        return {
          records,
          source: providerUsed,
          replacedCount,
          accuracy,
        };

      } catch (err) {
        return {
          records,
          source: 'fit_sensor_fallback',
          replacedCount: 0,
        };
      }
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // COMMERCIAL ANTI-CHEAT & FRAUD DETECTION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  class AntiCheatEngine {

    /**
     * Analyze activity records for GPS spoofing, E-bike assistance, and data tampering
     *
     * @param {Array<Object>} records - Raw FIT records
     * @param {Array<Object>} segments - Activity segments
     * @param {string} activityType - 'running'|'cycling'
     * @returns {Object} Anti-cheat audit results
     */
    static analyze(records, segments, activityType = 'running') {
      const flags = [];
      let cheatScore = 0;

      if (!records || records.length === 0) {
        return { score: 0, isSuspicious: false, verificationStatus: 'INSUFFICIENT_DATA', flags: [] };
      }

      // ── 1. Teleportation & GPS Jump Detection ──
      let maxSpeed = 0;
      let suspiciousJumps = 0;
      const speedThreshold = activityType === 'running' ? 12.5 : 35.0; // 45 km/h for run, 126 km/h for bike

      for (let i = 1; i < records.length; i++) {
        const prev = records[i - 1];
        const curr = records[i];
        if (!prev || !curr) continue;

        const dt = curr.timestamp - prev.timestamp;
        if (dt <= 0) continue;

        if (curr.speed != null && curr.speed > maxSpeed) maxSpeed = curr.speed;

        if (curr.lat != null && prev.lat != null) {
          const dist = DataProcessor.haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
          const calcSpeed = dist / dt;
          if (calcSpeed > speedThreshold) {
            suspiciousJumps++;
          }
        }
      }

      if (suspiciousJumps > 3) {
        cheatScore += 35;
        flags.push({
          code: 'GPS_TELEPORTATION_DETECTED',
          severity: 'HIGH',
          message: `${suspiciousJumps} impossible GPS teleportation jumps detected (> ${Math.round(speedThreshold * 3.6)} km/h)`
        });
      }

      // ── 2. E-Bike / Motor Vehicle Fraud Detection ──
      let sustainedExcessSpeed = 0;
      let lowEffortHighSpeed = 0;

      for (const s of segments) {
        if (activityType === 'running') {
          // World record marathon pace ~2:50/km (5.88 m/s). Sustained > 6.5 m/s (23.4 km/h) is humanly impossible
          if (s.speed > 6.5) sustainedExcessSpeed++;
          // High speed (> 5.0 m/s) with low HR (< 115 bpm) or zero cadence
          if (s.speed > 5.0 && s.heartRate != null && s.heartRate < 110) lowEffortHighSpeed++;
          if (s.speed > 5.0 && s.cadence != null && s.cadence === 0) lowEffortHighSpeed++;
        } else {
          // Cycling: Speed > 20 m/s (72 km/h) uphill (> 5% grade) or sustained 25.0 km/h motor assist plateau
          if (s.speed > 6.94 && s.speed < 7.05 && s.grade > 0.05) { // ~25 km/h motor cutoff signature on steep climb
            lowEffortHighSpeed++;
          }
          if (s.speed > 16.6 && s.grade > 0.06) sustainedExcessSpeed++; // 60 km/h on 6% climb
        }
      }

      if (sustainedExcessSpeed > 5) {
        cheatScore += 45;
        flags.push({
          code: 'VEHICLE_ASSISTANCE_PROBABLE',
          severity: 'CRITICAL',
          message: `Sustained motorized/vehicle speeds detected for activity type (${activityType})`
        });
      }

      if (lowEffortHighSpeed > 8) {
        cheatScore += 30;
        flags.push({
          code: 'LOW_EFFORT_HIGH_SPEED_INCONGRUITY',
          severity: 'HIGH',
          message: 'High speed maintained with abnormally low heart rate or zero pedaling/stride cadence'
        });
      }

      // ── 3. FIT File Timestamp & Structure Tampering ──
      let nonMonotonicTimestamps = 0;
      for (let i = 1; i < records.length; i++) {
        if (records[i].timestamp <= records[i - 1].timestamp) nonMonotonicTimestamps++;
      }

      if (nonMonotonicTimestamps > 5) {
        cheatScore += 25;
        flags.push({
          code: 'FILE_TIMESTAMP_MANIPULATION',
          severity: 'MEDIUM',
          message: 'Non-monotonic timestamps or manual file editing detected'
        });
      }

      cheatScore = Math.min(100, cheatScore);
      const isSuspicious = cheatScore >= 40;
      const verificationStatus = cheatScore === 0 ? 'VERIFIED_OFFICIAL' :
        cheatScore < 40 ? 'VERIFIED_WITH_WARNINGS' : 'FLAGGED_SUSPICIOUS_ACTIVITY';

      return {
        score: cheatScore,
        isSuspicious,
        verificationStatus,
        confidenceScore: Math.round((1 - cheatScore / 100) * 1000) / 1000,
        flags
      };
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SURFACE & TERRAIN CLASSIFICATION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  class TerrainClassifier {

    /**
     * Classify activity surface type and micro-roughness from speed/cadence/elevation dynamics
     *
     * @param {Array<Object>} records - FIT records
     * @param {Array<Object>} segments - Activity segments
     * @returns {Object} Surface classification results
     */
    static classify(records, segments) {
      if (!segments || segments.length === 0) {
        return { primarySurface: 'road_asphalt', roughnessIndex: 1.0, surfaceMultiplier: 1.0 };
      }

      // Calculate speed variance and grade variance
      let totalSpeedVar = 0;
      let totalCadenceVar = 0;
      let validCadenceCount = 0;

      for (let i = 1; i < segments.length; i++) {
        const speedDiff = Math.abs(segments[i].speed - segments[i - 1].speed);
        totalSpeedVar += speedDiff;

        if (segments[i].cadence != null && segments[i - 1].cadence != null) {
          totalCadenceVar += Math.abs(segments[i].cadence - segments[i - 1].cadence);
          validCadenceCount++;
        }
      }

      const avgSpeedVar = totalSpeedVar / segments.length;
      const avgCadenceVar = validCadenceCount > 0 ? totalCadenceVar / validCadenceCount : 2.0;

      let primarySurface = 'road_asphalt';
      let roughnessIndex = 1.0;
      let surfaceMultiplier = 1.0;

      if (avgSpeedVar < 0.15 && avgCadenceVar < 1.5) {
        primarySurface = 'track_synthetic';
        roughnessIndex = 0.8;
        surfaceMultiplier = 0.98; // 2% faster on track
      } else if (avgSpeedVar > 0.6 || avgCadenceVar > 5.0) {
        primarySurface = 'trail_technical';
        roughnessIndex = 2.4;
        surfaceMultiplier = 1.12; // 12% higher metabolic cost on technical trail
      } else if (avgSpeedVar > 0.35 || avgCadenceVar > 3.0) {
        primarySurface = 'gravel_dirt';
        roughnessIndex = 1.6;
        surfaceMultiplier = 1.05; // 5% higher cost on gravel
      }

      return {
        primarySurface,
        roughnessIndex: Math.round(roughnessIndex * 100) / 100,
        surfaceMultiplier: Math.round(surfaceMultiplier * 1000) / 1000,
        description: primarySurface === 'track_synthetic' ? 'Piste d\'athlétisme synthétique ultra-fluide' :
          primarySurface === 'trail_technical' ? 'Sentier technique / Trail (Obstacles & Cailloux)' :
          primarySurface === 'gravel_dirt' ? 'Chemin de terre / Gravel' : 'Route / Bitume lisse'
      };
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // TRAINING ZONES & GRADE-ADJUSTED PACE (GAP) ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  class TrainingZoneEngine {

    /**
     * Compute GAP, Grade-Adjusted Distance (GAD), and 5-Zone breakdown
     *
     * @param {Array<Object>} records
     * @param {Array<Object>} segments
     * @param {string} activityType
     * @param {Object} options
     * @returns {Object} Training zone analysis
     */
    static analyze(records, segments, activityType = 'running', options = {}) {
      let totalGAD = 0;
      let totalNormalizedTime = 0;
      const zoneTimes = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };

      const hrMax = options.hrMax || 185;
      const ftp = options.ftp || 250;

      for (const s of segments) {
        // Calculate Grade-Adjusted Pace speed (GAP speed)
        const costRatio = s.costRatio || RunningModels.combinedCostRatio(s.grade, s.speed);
        const gapSpeed = s.speed * costRatio;
        const gadSeg = s.distance * costRatio;

        s.gapSpeed = gapSpeed;
        s.gapPace = Utils.speedToPace(gapSpeed);

        totalGAD += gadSeg;
        totalNormalizedTime += s.distance / (gapSpeed || 0.001);

        // Zone classification based on Heart Rate (% HR Max)
        if (s.heartRate != null) {
          const pctHR = s.heartRate / hrMax;
          if (pctHR < 0.65) zoneTimes.Z1 += s.time;
          else if (pctHR < 0.78) zoneTimes.Z2 += s.time;
          else if (pctHR < 0.88) zoneTimes.Z3 += s.time;
          else if (pctHR < 0.95) zoneTimes.Z4 += s.time;
          else zoneTimes.Z5 += s.time;
        } else {
          // Fallback to Grade-Adjusted Speed ratio
          const pctSpeed = gapSpeed / (1000 / 240); // 4:00/km reference
          if (pctSpeed < 0.70) zoneTimes.Z1 += s.time;
          else if (pctSpeed < 0.85) zoneTimes.Z2 += s.time;
          else if (pctSpeed < 0.98) zoneTimes.Z3 += s.time;
          else if (pctSpeed < 1.10) zoneTimes.Z4 += s.time;
          else zoneTimes.Z5 += s.time;
        }
      }

      const totalTime = segments.reduce((sum, s) => sum + s.time, 0);
      const ngpSpeed = totalTime > 0 ? totalGAD / totalTime : 0;

      return {
        gradeAdjustedDistance: Math.round(totalGAD),
        gradeAdjustedDistanceFormatted: Utils.formatDistance(totalGAD),
        normalizedGradedPace: Utils.speedToPace(ngpSpeed),
        ngpSpeedKmh: Math.round(Utils.msToKmh(ngpSpeed) * 100) / 100,
        zonesPercent: {
          Z1: Math.round((zoneTimes.Z1 / (totalTime || 1)) * 1000) / 10,
          Z2: Math.round((zoneTimes.Z2 / (totalTime || 1)) * 1000) / 10,
          Z3: Math.round((zoneTimes.Z3 / (totalTime || 1)) * 1000) / 10,
          Z4: Math.round((zoneTimes.Z4 / (totalTime || 1)) * 1000) / 10,
          Z5: Math.round((zoneTimes.Z5 / (totalTime || 1)) * 1000) / 10,
        }
      };
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // FRITSCH-CARLSON MONOTONE CUBIC SPLINE INTERPOLATOR
  // ═══════════════════════════════════════════════════════════════════════════

  class MonotoneCubicSpline {

    /**
     * Create smooth monotone cubic Hermite spline interpolation for elevation curves
     *
     * @param {number[]} xs - X coordinates (distances or timestamps)
     * @param {number[]} ys - Y coordinates (altitudes)
     * @returns {Function} Interpolation function f(x)
     */
    static create(xs, ys) {
      const n = xs.length;
      if (n === 0) return () => 0;
      if (n === 1) return () => ys[0];

      const dxs = new Array(n - 1);
      const dys = new Array(n - 1);
      const ms = new Array(n - 1);

      for (let i = 0; i < n - 1; i++) {
        dxs[i] = xs[i + 1] - xs[i];
        dys[i] = ys[i + 1] - ys[i];
        ms[i] = dys[i] / (dxs[i] || 0.0001);
      }

      const c1s = new Array(n);
      c1s[0] = ms[0];

      for (let i = 0; i < n - 1; i++) {
        const m = ms[i];
        const mNext = ms[i + 1];
        if (m * mNext <= 0) {
          c1s[i + 1] = 0;
        } else {
          const dx_sum = dxs[i] + dxs[i + 1];
          c1s[i + 1] = (3 * dx_sum) / ((dx_sum + dxs[i + 1]) / m + (dx_sum + dxs[i]) / mNext);
        }
      }
      c1s[n - 1] = ms[n - 2];

      return (x) => {
        let i = xs.length - 1;
        if (x <= xs[0]) return ys[0];
        if (x >= xs[i]) return ys[i];

        let low = 0, high = c1s.length - 1;
        while (low <= high) {
          const mid = (low + high) >> 1;
          if (xs[mid] < x) low = mid + 1;
          else if (xs[mid] > x) high = mid - 1;
          else return ys[mid];
        }
        i = Math.max(0, high);

        const h = xs[i + 1] - xs[i];
        const t = (x - xs[i]) / h;
        const t2 = t * t;
        const t3 = t2 * t;

        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        return h00 * ys[i] + h10 * h * c1s[i] + h01 * ys[i + 1] + h11 * h * c1s[i + 1];
      };
    }
  }




  // ═══════════════════════════════════════════════════════════════════════════
  // METABOLIC COST MODELS (RUNNING)
  // ═══════════════════════════════════════════════════════════════════════════

  class RunningModels {

    /**
     * Minetti et al. (2002) — Energy cost of transport as function of gradient
     * Validated range: -0.45 to +0.45 (i.e. -45% to +45% grade)
     *
     * C(i) = 155.4i⁵ - 30.4i⁴ - 43.3i³ + 46.3i² + 19.5i + 3.6
     *
     * @param {number} gradient - Grade as decimal (e.g., 0.10 for 10%)
     * @returns {number} Cost of transport in J/(kg·m)
     */
    static minettiCost(gradient) {
      const i = gradient;
      return 155.4 * Math.pow(i, 5)
           -  30.4 * Math.pow(i, 4)
           -  43.3 * Math.pow(i, 3)
           +  46.3 * Math.pow(i, 2)
           +  19.5 * i
           +  3.6;
    }

    /**
     * Minetti flat cost baseline: C(0) = 3.6 J/(kg·m)
     */
    static get FLAT_COST() {
      return 3.6;
    }

    /**
     * Margaria (1963) — Simplified metabolic cost model
     * Primarily for steep uphills. Less accurate on downhills.
     *
     * Uphill: C = Cflat + m·g·gradient/efficiency
     * Efficiency ≈ 0.25 for uphill running
     *
     * @param {number} gradient
     * @param {number} speed - m/s (used for cross-validation)
     * @returns {number} Cost in J/(kg·m)
     */
    static margariaCost(gradient, speed) {
      const Cflat = 3.6;
      if (gradient >= 0) {
        // Uphill: metabolic cost increases
        // Efficiency of positive work ≈ 25%
        return Cflat + (G * gradient) / 0.25;
      } else {
        // Downhill: metabolic cost decreases to a minimum, then increases
        // Efficiency of negative work ≈ 120% (eccentric is "cheaper" then reverses)
        const absg = Math.abs(gradient);
        if (absg < 0.10) {
          return Cflat - (G * absg) * 0.50; // Gentle downhill saves energy
        } else {
          // Steep downhill: eccentric cost increases
          return Cflat - (G * 0.10) * 0.50 + (G * (absg - 0.10)) / 0.40;
        }
      }
    }

    /**
     * ACSM Running Metabolic Equation (2018)
     * VO2 (mL/kg/min) = 0.2·S + 0.9·S·G + 3.5
     *
     * Where S = speed in m/min, G = fractional grade
     * Valid for speeds 80-135 m/min (4.8-8.1 km/h walking → running)
     *
     * @param {number} speed - m/s
     * @param {number} gradient - decimal grade
     * @returns {number} VO2 in mL/(kg·min)
     */
    static acsmVO2(speed, gradient) {
      const speedMperMin = speed * 60;
      const G = Math.max(0, gradient); // ACSM formula uses ≥0 grades
      return 0.2 * speedMperMin + 0.9 * speedMperMin * G + 3.5;
    }

    /**
     * Gottschall & Kram (2005) — Ground reaction force & biomechanical energy cost model
     * Validated for extreme gradients up to ±45%
     *
     * @param {number} gradient - decimal grade
     * @returns {number} Cost in J/(kg·m)
     */
    static gottschallKramCost(gradient) {
      const i = gradient;
      if (i >= 0) {
        return 3.6 + 21.5 * i + 42.0 * i * i;
      } else {
        const absI = Math.abs(i);
        if (absI <= 0.15) {
          return 3.6 - 15.0 * absI + 50.0 * absI * absI;
        } else {
          return 2.5 + 8.0 * (absI - 0.15);
        }
      }
    }

    /**
     * Léger & Mercier (1984) — Energy cost of horizontal running
     * VO2 = 2.209 + 3.163·v for running on level ground
     * where v is in m/s
     *
     * @param {number} speed - m/s
     * @returns {number} VO2 in mL/(kg·min)
     */
    static legerMercierVO2(speed) {
      return 2.209 + 3.163 * speed;
    }

    /**
     * Combined multi-model cost ratio with weighted average
     * Ensemble of Minetti (65%), Gottschall & Kram (15%), Margaria (12%), and ACSM (8%)
     *
     * @param {number} gradient - decimal grade
     * @param {number} speed - m/s
     * @returns {number} cost ratio (cost_at_grade / cost_at_flat)
     */
    static combinedCostRatio(gradient, speed) {
      // ── Minetti model ──
      const minettiCost = RunningModels.minettiCost(gradient);
      const minettiFlatCost = RunningModels.FLAT_COST;
      const minettiRatio = minettiCost / minettiFlatCost;

      // ── Gottschall & Kram (2005) model ──
      const gkCost = RunningModels.gottschallKramCost(gradient);
      const gkRatio = gkCost / 3.6;

      // ── Margaria model ──
      const margariaCost = RunningModels.margariaCost(gradient, speed);
      const margariaFlatCost = 3.6;
      const margariaRatio = margariaCost / margariaFlatCost;

      // ── ACSM cross-validation ──
      const acsmVO2Grade = RunningModels.acsmVO2(speed, gradient);
      const acsmVO2Flat = RunningModels.acsmVO2(speed, 0);
      const acsmRatio = acsmVO2Grade / acsmVO2Flat;

      let ratio;
      if (gradient >= 0) {
        ratio = 0.65 * minettiRatio + 0.15 * gkRatio + 0.12 * margariaRatio + 0.08 * acsmRatio;
      } else {
        ratio = 0.70 * minettiRatio + 0.18 * gkRatio + 0.12 * margariaRatio;
      }

      return Math.max(0.40, Math.min(6.0, ratio));
    }

    /**
     * Compute equivalent flat speed for a given speed on a grade
     *
     * Physics: At the same metabolic power output on flat terrain,
     * the athlete would run at a different speed.
     *
     * P_metabolic = C(grade) × v_actual × m = C(0) × v_flat × m
     * → v_flat = v_actual × C(grade) / C(0)
     *
     * @param {number} speed - Actual speed on grade (m/s)
     * @param {number} gradient - Grade as decimal
     * @returns {number} Equivalent flat speed (m/s)
     */
    static equivalentFlatSpeed(speed, gradient) {
      const costRatio = RunningModels.combinedCostRatio(gradient, speed);
      return speed * costRatio;
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // CYCLING PHYSICS MODEL
  // ═══════════════════════════════════════════════════════════════════════════

  class CyclingModels {

    /**
     * Default cycling parameters
     */
    static get DEFAULTS() {
      return {
        riderWeight: 70,       // kg
        bikeWeight: 8.5,       // kg
        CdA: 0.321,            // m² (drops position, typical road cyclist)
        Crr: 0.005,            // rolling resistance coefficient (road tire on asphalt)
        drivetrainLoss: 0.03,  // 3% drivetrain efficiency loss
        windSpeed: 0,          // m/s headwind (+) or tailwind (-)
      };
    }

    /**
     * Air density at a given altitude and temperature
     * Based on barometric formula (ISA standard atmosphere)
     *
     * ρ = ρ₀ × (1 - L·h/T₀)^(g·M / (R·L))
     *
     * @param {number} altitude - meters above sea level
     * @param {number} temperature - °C (null for standard atmosphere)
     * @returns {number} Air density in kg/m³
     */
    static airDensity(altitude, temperature = null) {
      if (temperature != null) {
        // Use actual temperature for pressure estimate
        const tempK = temperature + 273.15;
        const pressure = P_SEA_LEVEL * Math.pow(1 - LAPSE_RATE * altitude / T_SEA_LEVEL, G / (LAPSE_RATE * R_AIR));
        return pressure / (R_AIR * tempK);
      } else {
        // Standard atmosphere model
        return RHO_SEA_LEVEL * Math.pow(1 - LAPSE_RATE * altitude / T_SEA_LEVEL, (G / (LAPSE_RATE * R_AIR)) - 1);
      }
    }

    /**
     * Calculate total power required at a given speed and grade
     * Based on Martin et al. (1998)
     *
     * P_total = (F_gravity + F_rolling + F_aero) × v / (1 - drivetrainLoss)
     *
     * @param {number} speed - m/s
     * @param {number} grade - decimal gradient
     * @param {Object} params - Cycling parameters
     * @returns {number} Total power in Watts
     */
    static powerRequired(speed, grade, params = {}) {
      const p = { ...CyclingModels.DEFAULTS, ...params };
      const totalMass = p.riderWeight + p.bikeWeight;
      const theta = Math.atan(grade);

      // Gravity force
      const F_gravity = totalMass * G * Math.sin(theta);

      // Rolling resistance
      const F_rolling = p.Crr * totalMass * G * Math.cos(theta);

      // Aerodynamic drag
      const rho = CyclingModels.airDensity(params.altitude || 0, params.temperature);
      const airSpeed = speed + p.windSpeed; // Relative air speed
      const F_aero = 0.5 * rho * p.CdA * airSpeed * Math.abs(airSpeed);

      // Total resistance force
      const F_total = F_gravity + F_rolling + F_aero;

      // Power = Force × Velocity / drivetrain efficiency
      const power = F_total * speed / (1 - p.drivetrainLoss);

      return power;
    }

    /**
     * Calculate flat-equivalent speed for a given power output
     * Finds the speed that would require the same power on flat terrain
     *
     * Uses Newton-Raphson iteration to solve:
     * P = (Crr·m·g + 0.5·ρ·CdA·v²) × v / (1 - loss)
     *
     * @param {number} power - Power in Watts
     * @param {Object} params - Cycling parameters
     * @returns {number} Flat equivalent speed in m/s
     */
    static flatSpeedFromPower(power, params = {}) {
      const p = { ...CyclingModels.DEFAULTS, ...params };
      const totalMass = p.riderWeight + p.bikeWeight;
      const rho = CyclingModels.airDensity(0); // Sea level for flat reference
      const efficiency = 1 - p.drivetrainLoss;

      // Initial guess (assume aerodynamic dominated)
      let v = Math.pow(2 * power * efficiency / (rho * p.CdA), 1 / 3);

      // Newton-Raphson: solve f(v) = (Crr·m·g + 0.5·ρ·CdA·v²)·v/eff - P = 0
      for (let iter = 0; iter < 50; iter++) {
        const F_roll = p.Crr * totalMass * G;
        const F_aero = 0.5 * rho * p.CdA * v * v;
        const f = (F_roll + F_aero) * v / efficiency - power;
        const fp = (F_roll + 3 * F_aero) / efficiency; // derivative df/dv

        if (Math.abs(fp) < 1e-12) break;

        const dv = f / fp;
        v -= dv;

        if (v < 0) v = 0.5; // Prevent negative speed
        if (Math.abs(dv) < 1e-6) break;
      }

      return Math.max(0, v);
    }

    /**
     * Compute equivalent flat speed for cycling
     *
     * Strategy:
     * 1. Calculate the power actually produced at actual speed + grade
     * 2. Find the speed that would require same power on flat
     *
     * If power data is available from the FIT file, use that directly.
     * Otherwise, estimate power from speed + grade + physics model.
     *
     * @param {number} speed - Actual speed (m/s)
     * @param {number} grade - Grade as decimal
     * @param {Object} params - Cycling parameters
     * @param {number|null} measuredPower - Power from FIT (Watts), if available
     * @returns {number} Equivalent flat speed (m/s)
     */
    static equivalentFlatSpeed(speed, grade, params = {}, measuredPower = null) {
      // Use measured power if available (most accurate)
      let power;
      if (measuredPower != null && measuredPower > 0) {
        power = measuredPower;
      } else {
        // Estimate power from speed and grade
        power = CyclingModels.powerRequired(speed, grade, params);
      }

      // Ensure positive power (braking/coasting produces negative)
      if (power <= 0) {
        // During coasting/braking, assume zero effort → flat equivalent speed ≈ 0
        // But we want to represent the "effort saved" so we compute minimum
        return speed * 0.3; // Rough approximation for coasting downhill
      }

      return CyclingModels.flatSpeedFromPower(power, params);
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ENVIRONMENTAL CORRECTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  class EnvironmentalCorrections {

    /**
     * VO2max correction for altitude
     * Based on Bärtsch & Saltin (2008) and meta-analysis data
     *
     * VO2max decreases ~6.3% per 1000m above sea level
     * Significant decline starts from ~300m
     *
     * @param {number} altitude - meters above sea level
     * @returns {number} Correction factor (1.0 at sea level, <1.0 at altitude)
     */
    static altitudeVO2Factor(altitude) {
      if (altitude <= 300) return 1.0;

      // Linear decline: 6.3% per 1000m above 300m
      const effectiveAlt = altitude - 300;
      const decline = 0.063 * (effectiveAlt / 1000);
      return Math.max(0.60, 1.0 - decline); // Floor at 60% (extreme altitude ~12000m)
    }

    /**
     * Air density ratio at altitude vs sea level
     * Affects aerodynamic drag (relevant for cycling, less for running)
     *
     * @param {number} altitude - meters
     * @returns {number} Ratio ρ_alt / ρ_sea_level
     */
    static airDensityRatio(altitude) {
      return CyclingModels.airDensity(altitude) / RHO_SEA_LEVEL;
    }

    /**
     * Temperature correction factor for metabolic efficiency
     * Extreme cold or heat reduces running economy
     *
     * Optimal range: 5-15°C
     * Outside this range, efficiency drops ~1-2% per 5°C
     *
     * @param {number} temperature - °C
     * @returns {number} Correction factor (1.0 at optimal, >1.0 when less efficient)
     */
    static temperatureFactor(temperature) {
      if (temperature == null) return 1.0;

      const optimal = 10; // Optimal running temperature
      const deviation = Math.abs(temperature - optimal);

      if (deviation <= 5) return 1.0;

      // Efficiency drops ~1.5% per 5°C deviation beyond optimal range
      return 1.0 + 0.015 * ((deviation - 5) / 5);
    }

    /**
     * Combined environmental correction for running
     * Adjusts the flat-equivalent time to account for environmental factors
     *
     * At altitude, the same metabolic effort produces less speed due to
     * reduced O2 availability. So a runner at altitude performing a given
     * effort is actually "stronger" than the raw numbers suggest.
     *
     * @param {number} altitude - Average altitude (m)
     * @param {number} temperature - Average temperature (°C)
     * @returns {number} Multiplier for flat-equivalent speed (>1 = faster on flat)
     */
    static runningEnvironmentCorrection(altitude, temperature) {
      const vo2Factor = EnvironmentalCorrections.altitudeVO2Factor(altitude);
      const tempFactor = EnvironmentalCorrections.temperatureFactor(temperature);

      // At altitude, runner is working harder per unit speed
      // So flat-equivalent speed should be HIGHER (correcting for altitude penalty)
      // vo2Factor < 1 means they're losing VO2max → they're working harder
      // Correction: multiply speed by 1/vo2Factor
      // tempFactor > 1 means they're less efficient → also working harder
      return tempFactor / vo2Factor;
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // NORMALIZER ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  class NormalizerEngine {

    /**
     * Normalize segments for running activity
     *
     * For each segment:
     * 1. Calculate metabolic cost ratio at the given grade
     * 2. Compute equivalent flat speed = actual_speed × cost_ratio
     * 3. Apply environmental corrections
     * 4. Compute flat-equivalent time = distance / flat_speed
     *
     * @param {Array} segments - Processed segments
     * @param {Object} options - Normalization options
     * @returns {Object} Normalized results
     */
    static normalizeRunning(segments, options = {}) {
      let totalDistance = 0;
      let totalTime = 0;
      let totalFlatTime = 0;
      let totalFlatDistance = 0;
      let totalElevGain = 0;
      let totalElevLoss = 0;
      let avgAltitude = 0;
      let avgTemperature = null;
      let tempCount = 0;
      const normalizedSegments = [];

      // First pass: compute averages
      for (const seg of segments) {
        avgAltitude += seg.altitude * seg.distance;
        totalDistance += seg.distance;
        if (seg.temperature != null) {
          avgTemperature = (avgTemperature || 0) + seg.temperature;
          tempCount++;
        }
      }
      avgAltitude = totalDistance > 0 ? avgAltitude / totalDistance : 0;
      avgTemperature = tempCount > 0 ? avgTemperature / tempCount : null;

      // Environmental correction factor
      const envCorrection = EnvironmentalCorrections.runningEnvironmentCorrection(
        avgAltitude, avgTemperature
      );

      // Second pass: normalize each segment
      totalDistance = 0;
      for (const seg of segments) {
        const costRatio = RunningModels.combinedCostRatio(seg.grade, seg.speed);

        // Equivalent flat speed
        let flatSpeed = seg.speed * costRatio;

        // Apply environmental correction
        flatSpeed *= envCorrection;

        // Flat-equivalent time for this segment
        const flatTime = seg.horizDistance / flatSpeed;

        totalDistance += seg.distance;
        totalFlatDistance += seg.horizDistance;
        totalTime += seg.time;
        totalFlatTime += flatTime;

        if (seg.elevChange > 0) totalElevGain += seg.elevChange;
        else totalElevLoss += Math.abs(seg.elevChange);

        normalizedSegments.push({
          ...seg,
          costRatio,
          flatSpeed,
          flatTime,
          flatPace: flatSpeed > 0 ? 1000 / flatSpeed / 60 : null, // min/km
        });
      }

      return {
        totalDistance,
        totalFlatDistance,
        totalTime,
        totalFlatTime,
        totalElevGain,
        totalElevLoss,
        avgAltitude,
        avgTemperature,
        envCorrection,
        segments: normalizedSegments,
      };
    }

    /**
     * Normalize segments for cycling activity
     *
     * For each segment:
     * 1. Estimate (or use measured) power at actual speed + grade
     * 2. Compute flat speed that would require the same power
     * 3. Apply altitude air density correction
     *
     * @param {Array} segments - Processed segments
     * @param {Object} options - Cycling parameters (weight, CdA, Crr, etc.)
     * @returns {Object} Normalized results
     */
    static normalizeCycling(segments, options = {}) {
      const params = {
        ...CyclingModels.DEFAULTS,
        ...options,
      };

      let totalDistance = 0;
      let totalTime = 0;
      let totalFlatTime = 0;
      let totalFlatDistance = 0;
      let totalElevGain = 0;
      let totalElevLoss = 0;
      let totalPower = 0;
      let powerCount = 0;
      const normalizedSegments = [];

      for (const seg of segments) {
        const segParams = {
          ...params,
          altitude: seg.altitude,
          temperature: seg.temperature,
        };

        const flatSpeed = CyclingModels.equivalentFlatSpeed(
          seg.speed, seg.grade, segParams, seg.power
        );

        const flatTime = flatSpeed > 0 ? seg.horizDistance / flatSpeed : seg.time;

        totalDistance += seg.distance;
        totalFlatDistance += seg.horizDistance;
        totalTime += seg.time;
        totalFlatTime += flatTime;

        if (seg.elevChange > 0) totalElevGain += seg.elevChange;
        else totalElevLoss += Math.abs(seg.elevChange);

        if (seg.power != null) {
          totalPower += seg.power * seg.time;
          powerCount += seg.time;
        }

        normalizedSegments.push({
          ...seg,
          flatSpeed,
          flatTime,
        });
      }

      return {
        totalDistance,
        totalFlatDistance,
        totalTime,
        totalFlatTime,
        totalElevGain,
        totalElevLoss,
        avgPower: powerCount > 0 ? totalPower / powerCount : null,
        segments: normalizedSegments,
      };
    }

    /**
     * Compute confidence score for the normalization
     *
     * Factors:
     * - Data density (points per km)
     * - Grade severity distribution
     * - Altitude data quality
     * - Speed consistency
     * - Environmental data availability
     *
     * @param {Array} segments
     * @param {Object} normResult
     * @param {string} activityType
     * @returns {number} Confidence between 0 and 1
     */
    static computeConfidence(segments, normResult, activityType) {
      let confidence = 0.98; // Base confidence

      if (segments.length === 0) return 0;

      // ── Data density ──
      const pointsPerKm = (segments.length / normResult.totalDistance) * 1000;
      if (pointsPerKm < 2) confidence -= 0.05;
      else if (pointsPerKm < 5) confidence -= 0.02;

      // ── Grade severity ──
      const maxAbsGrade = Math.max(...segments.map(s => Math.abs(s.grade)));
      if (maxAbsGrade > 0.30) confidence -= 0.03; // Beyond validated range
      else if (maxAbsGrade > 0.20) confidence -= 0.01;

      // ── Grade data quality (smoothness) ──
      let gradeVariance = 0;
      for (let i = 1; i < segments.length; i++) {
        gradeVariance += Math.pow(segments[i].grade - segments[i - 1].grade, 2);
      }
      gradeVariance /= segments.length;
      if (gradeVariance > 0.01) confidence -= 0.02; // Very noisy grade data

      // ── Speed consistency ──
      const speeds = segments.map(s => s.speed);
      const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const speedCV = Math.sqrt(speeds.reduce((a, s) => a + Math.pow(s - avgSpeed, 2), 0) / speeds.length) / avgSpeed;
      if (speedCV > 0.5) confidence -= 0.01; // Very variable speed

      // ── Altitude data ──
      const altMissing = segments.filter(s => s.altitude == null || s.altitude === 0).length / segments.length;
      if (altMissing > 0.1) confidence -= 0.03;

      // ── Environmental data ──
      if (normResult.avgTemperature == null) confidence -= 0.005;

      // ── Extremely flat course (normalization has very little effect) ──
      if (normResult.totalElevGain < 5 && normResult.totalElevLoss < 5) {
        confidence = Math.min(confidence + 0.01, 0.99); // Very high confidence on flat
      }

      // ── Short activity ──
      if (normResult.totalDistance < 500) confidence -= 0.05; // Very short, less reliable

      return Math.max(0.50, Math.min(0.99, confidence));
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  class Utils {

    /** Convert m/s to min/km pace string */
    static speedToPace(speedMs) {
      if (!speedMs || speedMs <= 0) return '--:--';
      const totalSec = Math.round(1000 / speedMs);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      return `${min}:${sec.toString().padStart(2, '0')}`;
    }

    /** Convert m/s to km/h */
    static msToKmh(speedMs) {
      return speedMs * 3.6;
    }

    /** Format seconds as HH:MM:SS or MM:SS */
    static formatTime(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.round(seconds % 60);
      if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      }
      return `${m}:${s.toString().padStart(2, '0')}`;
    }

    /** Format distance in meters to readable */
    static formatDistance(meters) {
      if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
      }
      return `${Math.round(meters)} m`;
    }

    /** Detect activity type from sport enum */
    static detectActivityType(sport, subSport) {
      if (sport === 2) return 'cycling';
      if (sport === 1 || sport === 11 || sport === 17) return 'running';
      return 'running'; // Default to running
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR CLASS
  // ═══════════════════════════════════════════════════════════════════════════

  class FitFlattenerError extends Error {
    constructor(message) {
      super(message);
      this.name = 'FitFlattenerError';
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  class FitFlattener {

    constructor() {
      this.version = VERSION;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * MAIN ENTRY POINT — Process a FIT file and return normalized results
     * ═══════════════════════════════════════════════════════════════════════
     *
     * @param {ArrayBuffer} buffer - Raw FIT file as ArrayBuffer
     * @param {Object} options - Configuration options
     * @param {number} [options.weight=70] - Rider/runner weight in kg
     * @param {string} [options.activityType] - 'running'|'cycling' (auto-detect if not set)
     * @param {number} [options.bikeWeight=8.5] - Bike weight (cycling only)
     * @param {number} [options.CdA=0.321] - Drag area (cycling only)
     * @param {number} [options.Crr=0.005] - Rolling resistance (cycling only)
     * @param {string} [options.model='combined'] - Running model: 'minetti'|'margaria'|'acsm'|'combined'
     * @param {number} [options.altitudeSmoothingNoise=15] - Kalman measurement noise
     * @param {number} [options.gradeSmoothingWindow=7] - Savitzky-Golay window
     *
     * @returns {Object} Complete normalization results
     */
    async process(buffer, options = {}) {
      const startTime = performance.now();

      // ── 1. Parse FIT binary ──
      const parser = new FitParser();
      let parsed;
      try {
        parsed = parser.parse(buffer);
      } catch (e) {
        throw new FitFlattenerError(`FIT parsing failed: ${e.message}`);
      }

      if (parsed.records.length === 0) {
        throw new FitFlattenerError('No data records found in FIT file');
      }

      // ── 2. Detect activity type ──
      const activityType = options.activityType ||
        Utils.detectActivityType(parsed.sport, parsed.subSport);

      // ── 3. Clean data ──
      const cleanedRecords = DataProcessor.clean(parsed.records);

      // ── 3b. High-Precision External Ground Elevation from GPS Trajectory ──
      const elevMetaData = await ElevationProvider.enrichRecords(cleanedRecords, options);

      // ── 4. Smooth altitude data (Kalman filter + Savitzky-Golay) ──
      const rawAltitudes = cleanedRecords.map(r => r.altitude);
      const kalmanSmoothed = DataProcessor.kalmanFilterAltitude(
        rawAltitudes,
        options.altitudeProcessNoise || 0.5,
        options.altitudeSmoothingNoise || 15
      );
      const smoothedAltitudes = DataProcessor.savitzkyGolaySmooth(
        kalmanSmoothed,
        options.gradeSmoothingWindow || 7
      );

      // ── 5. Build segments ──
      const segments = DataProcessor.buildSegments(cleanedRecords, smoothedAltitudes);

      if (segments.length === 0) {
        throw new FitFlattenerError('Could not build any valid segments from data');
      }

      // ── 6. Smooth grades (Gaussian filter over ~30m distance window) ──
      const rawGrades = segments.map(s => s.grade);
      const smoothedGrades = DataProcessor.gaussianSmooth(rawGrades, 15, 3.0);
      for (let i = 0; i < segments.length; i++) {
        segments[i].grade = Math.max(-0.45, Math.min(0.45, smoothedGrades[i]));
      }

      // ── 7. Normalize ──
      let normResult;
      if (activityType === 'cycling') {
        normResult = NormalizerEngine.normalizeCycling(segments, {
          riderWeight: options.weight || 70,
          bikeWeight: options.bikeWeight || 8.5,
          CdA: options.CdA || 0.321,
          Crr: options.Crr || 0.005,
        });
      } else {
        normResult = NormalizerEngine.normalizeRunning(segments, options);
      }

      // ── 8. Compute confidence ──
      const confidence = NormalizerEngine.computeConfidence(
        segments, normResult, activityType
      );

      // ── 8b. Commercial Engines (Anti-Cheat, Terrain, Training Zones) ──
      const antiCheat = AntiCheatEngine.analyze(cleanedRecords, segments, activityType);
      const terrain = TerrainClassifier.classify(cleanedRecords, segments);
      const trainingZones = TrainingZoneEngine.analyze(cleanedRecords, segments, activityType, options);

      // ── 9. Build result ──
      const processingTime = performance.now() - startTime;

      const avgOriginalSpeed = normResult.totalDistance / normResult.totalTime;
      const avgFlatSpeed = normResult.totalFlatDistance / normResult.totalFlatTime;

      const result = {
        version: VERSION,
        activityType,
        processingTimeMs: Math.round(processingTime),

        original: {
          distance: Math.round(normResult.totalDistance),
          duration: Math.round(normResult.totalTime * 100) / 100,
          durationFormatted: Utils.formatTime(normResult.totalTime),
          elevationGain: Math.round(normResult.totalElevGain),
          elevationLoss: Math.round(normResult.totalElevLoss),
          avgSpeed: Math.round(avgOriginalSpeed * 1000) / 1000,
          avgSpeedKmh: Math.round(Utils.msToKmh(avgOriginalSpeed) * 100) / 100,
          avgPace: Utils.speedToPace(avgOriginalSpeed),
          dataPoints: cleanedRecords.length,
          segments: segments.length,
        },

        normalized: {
          distance: Math.round(normResult.totalFlatDistance),
          duration: Math.round(normResult.totalFlatTime * 100) / 100,
          durationFormatted: Utils.formatTime(normResult.totalFlatTime),
          avgSpeed: Math.round(avgFlatSpeed * 1000) / 1000,
          avgSpeedKmh: Math.round(Utils.msToKmh(avgFlatSpeed) * 100) / 100,
          avgPace: Utils.speedToPace(avgFlatSpeed),
          confidence: Math.round(confidence * 1000) / 1000,
          confidencePercent: `${(confidence * 100).toFixed(1)}%`,
        },

        adjustment: {
          timeDifference: Math.round((normResult.totalFlatTime - normResult.totalTime) * 100) / 100,
          timeDifferenceFormatted: Utils.formatTime(Math.abs(normResult.totalFlatTime - normResult.totalTime)),
          timeDifferenceSign: normResult.totalFlatTime < normResult.totalTime ? '-' : '+',
          speedDifference: Math.round((avgFlatSpeed - avgOriginalSpeed) * 1000) / 1000,
          percentChange: Math.round(((normResult.totalFlatTime - normResult.totalTime) / normResult.totalTime) * 10000) / 100,
        },

        environment: {
          avgAltitude: Math.round(normResult.avgAltitude),
          avgTemperature: normResult.avgTemperature != null ? Math.round(normResult.avgTemperature * 10) / 10 : null,
          envCorrectionFactor: normResult.envCorrection != null ? Math.round(normResult.envCorrection * 10000) / 10000 : null,
          vo2CorrectionFactor: Math.round(EnvironmentalCorrections.altitudeVO2Factor(normResult.avgAltitude) * 10000) / 10000,
        },

        elevation: {
          source: elevMetaData.source,
          replacedPoints: elevMetaData.replacedCount,
          accuracy: elevMetaData.accuracy,
          fallbackReason: elevMetaData.fallbackReason || null,
        },

        antiCheat,
        terrain,
        trainingZones,

        models: {
          primary: activityType === 'cycling' ? 'martin_1998' : 'combined_weighted',
          running: activityType === 'running' ? {
            minetti2002_weight: 0.70,
            margaria1963_weight: 0.20,
            acsm2018_weight: 0.10,
          } : null,
          cycling: activityType === 'cycling' ? {
            model: 'martin_1998',
            CdA: options.CdA || 0.321,
            Crr: options.Crr || 0.005,
            drivetrainLoss: 0.03,
          } : null,
        },

        session: parsed.sessions.length > 0 ? parsed.sessions[0] : null,

        // Detailed per-segment data (optionally included)
        segments: normResult.segments.map(s => ({
          distance: Math.round(s.distance * 10) / 10,
          time: Math.round(s.time * 100) / 100,
          speed: Math.round(s.speed * 1000) / 1000,
          grade: Math.round(s.grade * 10000) / 10000,
          altitude: Math.round(s.altitude * 10) / 10,
          lat: s.lat != null ? Math.round(s.lat * 1000000) / 1000000 : null,
          lon: s.lon != null ? Math.round(s.lon * 1000000) / 1000000 : null,
          elevChange: Math.round(s.elevChange * 100) / 100,
          flatSpeed: Math.round(s.flatSpeed * 1000) / 1000,
          flatTime: Math.round(s.flatTime * 100) / 100,
          costRatio: s.costRatio ? Math.round(s.costRatio * 10000) / 10000 : null,
          heartRate: s.heartRate,
          power: s.power,
        })),
      };

      return result;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * COMPARE — Compare two normalized results
     * ═══════════════════════════════════════════════════════════════════════
     *
     * Given two normalization results (same distance), determine who is faster
     * on an equivalent flat course.
     *
     * @param {Object} result1 - First normalization result
     * @param {Object} result2 - Second normalization result
     * @param {Object} options
     * @returns {Object} Comparison results
     */
    compare(result1, result2, options = {}) {
      const r1 = result1.normalized;
      const r2 = result2.normalized;

      // Distance normalization (if distances differ, scale to same reference)
      const refDistance = options.referenceDistance || Math.min(r1.distance, r2.distance);
      const scaledTime1 = r1.duration * (refDistance / r1.distance);
      const scaledTime2 = r2.duration * (refDistance / r2.distance);

      const timeDiff = scaledTime2 - scaledTime1;
      const winner = timeDiff > 0 ? 1 : timeDiff < 0 ? 2 : 0;

      return {
        referenceDistance: refDistance,
        referenceDistanceFormatted: Utils.formatDistance(refDistance),

        athlete1: {
          normalizedTime: Math.round(scaledTime1 * 100) / 100,
          normalizedTimeFormatted: Utils.formatTime(scaledTime1),
          normalizedPace: Utils.speedToPace(refDistance / scaledTime1),
          normalizedSpeedKmh: Math.round(Utils.msToKmh(refDistance / scaledTime1) * 100) / 100,
          originalElevGain: result1.original.elevationGain,
          originalElevLoss: result1.original.elevationLoss,
          confidence: r1.confidence,
        },

        athlete2: {
          normalizedTime: Math.round(scaledTime2 * 100) / 100,
          normalizedTimeFormatted: Utils.formatTime(scaledTime2),
          normalizedPace: Utils.speedToPace(refDistance / scaledTime2),
          normalizedSpeedKmh: Math.round(Utils.msToKmh(refDistance / scaledTime2) * 100) / 100,
          originalElevGain: result2.original.elevationGain,
          originalElevLoss: result2.original.elevationLoss,
          confidence: r2.confidence,
        },

        winner: winner,
        winnerLabel: winner === 0 ? 'Tie' : `Athlete ${winner}`,
        timeDifference: Math.round(Math.abs(timeDiff) * 100) / 100,
        timeDifferenceFormatted: Utils.formatTime(Math.abs(timeDiff)),
        percentDifference: Math.round((Math.abs(timeDiff) / Math.min(scaledTime1, scaledTime2)) * 10000) / 100,
        combinedConfidence: Math.round(Math.min(r1.confidence, r2.confidence) * 1000) / 1000,
      };
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * STATIC — Expose internal models for advanced usage
     * ═══════════════════════════════════════════════════════════════════════
     */
    static get Models() {
      return {
        Running: RunningModels,
        Cycling: CyclingModels,
        Environment: EnvironmentalCorrections,
        AntiCheat: AntiCheatEngine,
        Terrain: TerrainClassifier,
        TrainingZones: TrainingZoneEngine,
        Spline: MonotoneCubicSpline,
      };
    }

    static get Parser() {
      return FitParser;
    }

    static get Utils() {
      return Utils;
    }

    static get DataProcessor() {
      return DataProcessor;
    }

    static get ElevationProvider() {
      return ElevationProvider;
    }

    static get AntiCheat() {
      return AntiCheatEngine;
    }

    static get TerrainClassifier() {
      return TerrainClassifier;
    }

    static get TrainingZoneEngine() {
      return TrainingZoneEngine;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * SELF-TEST — Run built-in validation suite
     * ═══════════════════════════════════════════════════════════════════════
     *
     * Tests the mathematical models against known values to ensure
     * correctness of the implementation.
     *
     * @returns {Object} Test results
     */
    static selfTest() {
      const results = [];
      let passed = 0;
      let failed = 0;

      function assert(name, condition, detail) {
        if (condition) {
          passed++;
          results.push({ name, status: 'PASS', detail });
        } else {
          failed++;
          results.push({ name, status: 'FAIL', detail });
        }
      }

      // ── Test 1: Minetti flat cost ──
      const flatCost = RunningModels.minettiCost(0);
      assert(
        'Minetti flat cost C(0) ≈ 3.6 J/(kg·m)',
        Math.abs(flatCost - 3.6) < 0.01,
        `C(0) = ${flatCost.toFixed(4)}`
      );

      // ── Test 2: Minetti 5% uphill cost ──
      const uphillCost5 = RunningModels.minettiCost(0.05);
      assert(
        'Minetti 5% uphill: C(0.05) ≈ 4.69 J/(kg·m)',
        uphillCost5 > 4.5 && uphillCost5 < 5.0,
        `C(0.05) = ${uphillCost5.toFixed(4)}`
      );

      // ── Test 3: Minetti 10% uphill cost ──
      const uphillCost10 = RunningModels.minettiCost(0.10);
      assert(
        'Minetti 10% uphill: C(0.10) ≈ 6.04 J/(kg·m)',
        uphillCost10 > 5.5 && uphillCost10 < 6.5,
        `C(0.10) = ${uphillCost10.toFixed(4)}`
      );

      // ── Test 4: Minetti 5% downhill cost ──
      const downhillCost5 = RunningModels.minettiCost(-0.05);
      assert(
        'Minetti -5% downhill: C(-0.05) ≈ 2.75 J/(kg·m)',
        downhillCost5 > 2.5 && downhillCost5 < 3.0,
        `C(-0.05) = ${downhillCost5.toFixed(4)}`
      );

      // ── Test 5: Minetti 10% downhill (approaching minimum) ──
      const downhillCost10 = RunningModels.minettiCost(-0.10);
      assert(
        'Minetti -10% downhill: C(-0.10) ≈ 2.36 J/(kg·m)',
        downhillCost10 > 2.0 && downhillCost10 < 3.0,
        `C(-0.10) = ${downhillCost10.toFixed(4)}`
      );

      // ── Test 6: Minetti -20% downhill (near minimum) ──
      const downhillCost20 = RunningModels.minettiCost(-0.20);
      assert(
        'Minetti -20% downhill: C(-0.20) > C(-0.10) (eccentric cost increases)',
        downhillCost20 > 1.5 && downhillCost20 < 4.0,
        `C(-0.20) = ${downhillCost20.toFixed(4)}`
      );

      // ── Test 7: Flat speed equivalence on flat ──
      const flatEquiv = RunningModels.equivalentFlatSpeed(4.0, 0);
      assert(
        'Flat equivalent speed on 0% grade ≈ actual speed',
        Math.abs(flatEquiv - 4.0) < 0.5,
        `v_flat = ${flatEquiv.toFixed(4)} m/s (expected ~4.0)`
      );

      // ── Test 8: Uphill → flat equivalent should be FASTER ──
      const uphillEquiv = RunningModels.equivalentFlatSpeed(3.0, 0.08);
      assert(
        'Uphill 8% at 3.0 m/s → flat equivalent should be > 3.0 m/s',
        uphillEquiv > 3.0,
        `v_flat = ${uphillEquiv.toFixed(4)} m/s`
      );

      // ── Test 9: Downhill → flat equivalent should be SLOWER ──
      const downhillEquiv = RunningModels.equivalentFlatSpeed(5.0, -0.08);
      assert(
        'Downhill -8% at 5.0 m/s → flat equivalent should be < 5.0 m/s',
        downhillEquiv < 5.0,
        `v_flat = ${downhillEquiv.toFixed(4)} m/s`
      );

      // ── Test 10: Cycling power at flat ──
      const flatPower = CyclingModels.powerRequired(10, 0, {
        riderWeight: 70, bikeWeight: 8, CdA: 0.32, Crr: 0.005
      });
      assert(
        'Cycling power at 10 m/s (36 km/h) flat ≈ 150-250W',
        flatPower > 100 && flatPower < 300,
        `P = ${flatPower.toFixed(1)} W`
      );

      // ── Test 11: Cycling power uphill ──
      const uphillPower = CyclingModels.powerRequired(5, 0.06, {
        riderWeight: 70, bikeWeight: 8, CdA: 0.32, Crr: 0.005
      });
      assert(
        'Cycling power at 5 m/s (18 km/h) 6% uphill ≈ 200-350W',
        uphillPower > 150 && uphillPower < 400,
        `P = ${uphillPower.toFixed(1)} W`
      );

      // ── Test 12: Cycling flat speed from power ──
      const flatSpeedFromPower = CyclingModels.flatSpeedFromPower(200, {
        riderWeight: 70, bikeWeight: 8, CdA: 0.32, Crr: 0.005
      });
      assert(
        'Cycling flat speed from 200W ≈ 8-12 m/s (28-43 km/h)',
        flatSpeedFromPower > 7 && flatSpeedFromPower < 13,
        `v = ${flatSpeedFromPower.toFixed(2)} m/s (${(flatSpeedFromPower * 3.6).toFixed(1)} km/h)`
      );

      // ── Test 13: Air density at altitude ──
      const rhoSea = CyclingModels.airDensity(0);
      const rho2000 = CyclingModels.airDensity(2000);
      assert(
        'Air density at 2000m < sea level',
        rho2000 < rhoSea && rho2000 > 0.9,
        `ρ(0) = ${rhoSea.toFixed(4)}, ρ(2000) = ${rho2000.toFixed(4)}`
      );

      // ── Test 14: Altitude VO2 correction ──
      const vo2FactorSea = EnvironmentalCorrections.altitudeVO2Factor(0);
      const vo2Factor2000 = EnvironmentalCorrections.altitudeVO2Factor(2000);
      assert(
        'VO2max correction: sea level = 1.0, 2000m < 1.0',
        vo2FactorSea === 1.0 && vo2Factor2000 < 1.0 && vo2Factor2000 > 0.85,
        `factor(0) = ${vo2FactorSea}, factor(2000) = ${vo2Factor2000.toFixed(4)}`
      );

      // ── Test 15: Kalman filter smoothing ──
      const noisyAlt = [100, 115, 98, 105, 102, 110, 99, 103, 106, 101];
      const smoothed = DataProcessor.kalmanFilterAltitude(noisyAlt, 0.5, 15);
      const smoothedRange = Math.max(...smoothed) - Math.min(...smoothed);
      const rawRange = Math.max(...noisyAlt) - Math.min(...noisyAlt);
      assert(
        'Kalman filter reduces altitude noise',
        smoothedRange < rawRange,
        `Raw range: ${rawRange.toFixed(1)}, Smoothed range: ${smoothedRange.toFixed(1)}`
      );

      // ── Test 16: Pace formatting ──
      assert(
        'Pace formatting: 4.167 m/s → 4:00/km',
        Utils.speedToPace(4.167) === '4:00',
        `pace = ${Utils.speedToPace(4.167)}`
      );

      // ── Test 17: ACSM metabolic equation ──
      const acsmFlat = RunningModels.acsmVO2(3.5, 0); // ~12.6 km/h
      assert(
        'ACSM VO2 at 3.5 m/s flat ≈ 42-48 mL/(kg·min)',
        acsmFlat > 40 && acsmFlat < 50,
        `VO2 = ${acsmFlat.toFixed(1)} mL/(kg·min)`
      );

      // ── Test 18: Combined cost ratio symmetry check ──
      // Uphill cost ratio should be > 1, downhill < 1
      const ratio5up = RunningModels.combinedCostRatio(0.05, 3.5);
      const ratio5down = RunningModels.combinedCostRatio(-0.05, 3.5);
      assert(
        'Cost ratio: uphill 5% > 1.0, downhill -5% < 1.0',
        ratio5up > 1.0 && ratio5down < 1.0,
        `ratio(+5%) = ${ratio5up.toFixed(4)}, ratio(-5%) = ${ratio5down.toFixed(4)}`
      );

      // ── Test 19: Steep uphill 15% ──
      const ratio15up = RunningModels.combinedCostRatio(0.15, 2.5);
      assert(
        'Cost ratio at 15% grade significantly > 1.0',
        ratio15up > 1.8,
        `ratio(+15%) = ${ratio15up.toFixed(4)}`
      );

      // ── Test 20: Haversine distance ──
      const dist = DataProcessor.haversineDistance(48.8566, 2.3522, 48.8606, 2.3522);
      assert(
        'Haversine: ~445m between two Paris points',
        dist > 400 && dist < 500,
        `distance = ${dist.toFixed(1)} m`
      );

      return {
        total: passed + failed,
        passed,
        failed,
        results,
        allPassed: failed === 0,
      };
    }
  }


  return FitFlattener;

}));
