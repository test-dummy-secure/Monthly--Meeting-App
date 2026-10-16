require('dotenv').config();
const db = require('./src/config/db');
const noteStructurerService = require('./src/services/notes/noteStructurer.service');

(async () => {
  const { rows } = await db.query(
    `SELECT mn.transcript_text
     FROM meeting_notes mn
     JOIN meetings m ON m.id = mn.meeting_id
     WHERE m.title = 'Testing-Monthly-Meeting-two'
     LIMIT 1`
  );
  const cleanText = rows[0].transcript_text;
  console.log('Transcript length:', cleanText.length, '| Model:', process.env.OLLAMA_MODEL);

  const start = Date.now();
  try {
    const result = await noteStructurerService.structure(
      { cleanText, sections: {}, charCount: cleanText.length },
      'benchmark-post-fix'
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n=== RESULT (${elapsed}s) ===`);
    console.log('actionItems:', result.actionItems?.length || 0);
    console.log('decisionsTaken:', result.decisionsTaken?.length || 0);
    console.log('risksDiscussed:', result.risksDiscussed?.length || 0);
    console.log('followUpActions:', result.followUpActions?.length || 0);
    const all = [
      ...(result.actionItems||[]), ...(result.decisionsTaken||[]),
      ...(result.risksDiscussed||[]), ...(result.followUpActions||[])
    ];
    console.log(`\nTOTAL ITEMS: ${all.length}`);
    all.forEach((it, i) => console.log(`${i+1}. ${it}`));
  } catch (err) {
    console.error('BENCHMARK FAILED:', err.message);
    console.error(err.stack);
  }
  process.exit(0);
})();
