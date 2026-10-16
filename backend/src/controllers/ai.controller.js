'use strict';

const AIRecommendationService = require('../services/ai/AIRecommendationService');
const logger = require('../utils/logger');

const aiController = {

  // GET /api/ai/providers — returns Ollama config + installed model list
  async getProviders(req, res, next) {
    try {
      const config = await AIRecommendationService.getProviderConfig();
      res.json(config);
    } catch (err) {
      next(err);
    }
  },

  // POST /api/ai/analyze
  // Body: { tenantId, meetingId, model? }
  async analyze(req, res, next) {
    try {
      const { tenantId, meetingId, model } = req.body;
      if (!tenantId || !meetingId) {
        return res.status(400).json({ error: 'tenantId and meetingId are required' });
      }
      const recommendations = await AIRecommendationService.analyze({
        tenantId,
        meetingId,
        user: req.user,
        model: model || null,
      });
      res.status(200).json({ recommendations, count: recommendations.length });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/ai/recommendations
  // Query: tenantId, meetingId, status, analysisType
  async listRecommendations(req, res, next) {
    try {
      const { tenantId, meetingId, status, analysisType } = req.query;
      const recommendations = await AIRecommendationService.listRecommendations({
        user: req.user,
        tenantId,
        meetingId,
        status,
        analysisType: analysisType || undefined,
      });
      res.json({ recommendations, count: recommendations.length });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/ai/recommendations/:id
  async getRecommendation(req, res, next) {
    try {
      const rec = await AIRecommendationService.getRecommendation({
        id: req.params.id,
        user: req.user,
      });
      res.json(rec);
    } catch (err) {
      next(err);
    }
  },

  // POST /api/ai/recommendations/:id/approve
  // Body: { tenantId }
  async approveRecommendation(req, res, next) {
    try {
      const { tenantId } = req.body;
      if (!tenantId) {
        return res.status(400).json({ error: 'tenantId is required' });
      }
      const result = await AIRecommendationService.approveRecommendation({
        id: req.params.id,
        user: req.user,
        tenantId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/ai/recommendations/:id
  // Body: { tenantId, ...editableFields }
  async updateRecommendation(req, res, next) {
    try {
      const { tenantId, ...fields } = req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
      const result = await AIRecommendationService.updateRecommendation({
        id: req.params.id,
        user: req.user,
        tenantId,
        fields,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  // POST /api/ai/recommendations/:id/reject
  // Body: { tenantId, reason }
  async rejectRecommendation(req, res, next) {
    try {
      const { tenantId, reason } = req.body;
      if (!tenantId) {
        return res.status(400).json({ error: 'tenantId is required' });
      }
      const result = await AIRecommendationService.rejectRecommendation({
        id: req.params.id,
        user: req.user,
        tenantId,
        reason,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = aiController;
