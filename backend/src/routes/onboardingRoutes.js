/* src/routes/onboardingRoutes.js */
const express = require('express');
const router = express.Router();

/**
 * GET /api/onboarding/status
 * Returns the onboarding status for the authenticated tenant / customer.
 */
router.get('/status', (_req, res) => {
  res.json({
    data: {
      currentStep: 3,
      totalSteps: 7,
      completedSteps: ['account_setup', 'team_invite', 'integration_connect'],
      pendingSteps: ['policy_config', 'scan_schedule', 'baseline_review', 'go_live'],
      percentComplete: 43,
    },
  });
});

/**
 * POST /api/onboarding/step
 * Marks an onboarding step as complete.
 */
router.post('/step', (req, res) => {
  const { stepId } = req.body;
  if (!stepId) {
    return res.status(400).json({ error: 'stepId is required' });
  }
  res.json({ data: { stepId, status: 'completed', completedAt: new Date().toISOString() } });
});

/**
 * GET /api/onboarding/checklist
 * Returns the full onboarding checklist.
 */
router.get('/checklist', (_req, res) => {
  res.json({
    data: [
      { id: 'account_setup', label: 'Account Setup', status: 'completed' },
      { id: 'team_invite', label: 'Invite Team Members', status: 'completed' },
      { id: 'integration_connect', label: 'Connect Integrations', status: 'completed' },
      { id: 'policy_config', label: 'Configure Policies', status: 'pending' },
      { id: 'scan_schedule', label: 'Schedule First Scan', status: 'pending' },
      { id: 'baseline_review', label: 'Review Baseline Report', status: 'pending' },
      { id: 'go_live', label: 'Go Live', status: 'pending' },
    ],
  });
});

module.exports = router;
