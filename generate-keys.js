// Lance ce script UNE SEULE FOIS pour générer tes clés VAPID
// node generate-keys.js
// Copie ensuite les clés dans les variables d’environnement Railway

const webpush = require(‘web-push’);
const keys = webpush.generateVAPIDKeys();
console.log(’\n✅ Clés VAPID générées :\n’);
console.log(‘VAPID_PUBLIC=’, keys.publicKey);
console.log(‘VAPID_PRIVATE=’, keys.privateKey);
console.log(’\nAjoute ces deux variables dans Railway → Variables\n’);
