// ShieldGuard Rule Validation Script
// Validates all DNR rule JSON files for correctness
const fs = require('fs');
const path = require('path');

const RULES_DIR = path.join(__dirname, '..', 'rules');
const VALID_RESOURCE_TYPES = new Set([
  'main_frame','sub_frame','stylesheet','script','image','font',
  'xmlhttprequest','media','websocket','other',
]);
const FORBIDDEN_RESOURCE_TYPES = new Set(['beacon']);
const VALID_ACTIONS = new Set(['block', 'allow', 'redirect', 'upgradeScheme', 'allowAllRequests']);
const FORBIDDEN_ACTIONS = new Set(['modifyHeaders']);

const files = ['ad_rules.json', 'tracker_rules.json', 'privacy_rules.json'];
const allIds = new Set();
let totalRules = 0;
let errors = 0;

for (const file of files) {
  const filepath = path.join(RULES_DIR, file);
  console.log(`\n=== Validating ${file} ===`);
  
  let rules;
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    rules = JSON.parse(raw);
  } catch (e) {
    console.error(`  ❌ PARSE ERROR: ${e.message}`);
    errors++;
    continue;
  }

  if (!Array.isArray(rules)) {
    console.error(`  ❌ Root element is not an array`);
    errors++;
    continue;
  }

  console.log(`  📦 ${rules.length} rules found`);
  totalRules += rules.length;

  for (const rule of rules) {
    // Check required fields
    if (typeof rule.id !== 'number') {
      console.error(`  ❌ Rule missing numeric id: ${JSON.stringify(rule).slice(0,80)}`);
      errors++;
      continue;
    }

    // Check unique IDs
    if (allIds.has(rule.id)) {
      console.error(`  ❌ DUPLICATE ID: ${rule.id}`);
      errors++;
    }
    allIds.add(rule.id);

    // Check action
    if (!rule.action || !rule.action.type) {
      console.error(`  ❌ Rule ${rule.id}: missing action.type`);
      errors++;
    } else if (FORBIDDEN_ACTIONS.has(rule.action.type)) {
      console.error(`  ❌ Rule ${rule.id}: FORBIDDEN action type "${rule.action.type}" (unsupported in Firefox DNR)`);
      errors++;
    } else if (!VALID_ACTIONS.has(rule.action.type)) {
      console.error(`  ❌ Rule ${rule.id}: invalid action type "${rule.action.type}"`);
      errors++;
    }

    // Check condition
    if (!rule.condition) {
      console.error(`  ❌ Rule ${rule.id}: missing condition`);
      errors++;
      continue;
    }

    // Check urlFilter
    if (!rule.condition.urlFilter || typeof rule.condition.urlFilter !== 'string') {
      console.error(`  ❌ Rule ${rule.id}: missing or invalid urlFilter`);
      errors++;
    }

    // Check for malformed urlFilter patterns (||domain.";)
    const filter = rule.condition.urlFilter || '';
    if (filter.includes('";') || filter.includes("';")) {
      console.error(`  ❌ Rule ${rule.id}: MALFORMED urlFilter contains quote+semicolon: "${filter}"`);
      errors++;
    }

    // Check resourceTypes
    if (!Array.isArray(rule.condition.resourceTypes) || rule.condition.resourceTypes.length === 0) {
      console.error(`  ❌ Rule ${rule.id}: missing or empty resourceTypes`);
      errors++;
    } else {
      for (const rt of rule.condition.resourceTypes) {
        if (FORBIDDEN_RESOURCE_TYPES.has(rt)) {
          console.error(`  ❌ Rule ${rule.id}: FORBIDDEN resourceType "${rt}" (not valid in Firefox DNR)`);
          errors++;
        } else if (!VALID_RESOURCE_TYPES.has(rt)) {
          console.error(`  ❌ Rule ${rule.id}: invalid resourceType "${rt}"`);
          errors++;
        }
      }
    }
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`📊 TOTAL RULES: ${totalRules}`);
console.log(`🔑 UNIQUE IDs:  ${allIds.size}`);
if (errors === 0) {
  console.log(`✅ ALL RULES VALID — No errors found!`);
  console.log(`   • No "beacon" resource types`);
  console.log(`   • No "modifyHeaders" actions`);
  console.log(`   • No malformed urlFilter patterns`);
  console.log(`   • All IDs unique across all files`);
} else {
  console.log(`❌ ${errors} ERROR(S) FOUND — fix before loading in Firefox`);
}
process.exit(errors > 0 ? 1 : 0);
