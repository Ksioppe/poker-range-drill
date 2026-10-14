POKER RANGE DRILL — FICHIERS CORRIGÉS

Contenu :
- index.html : page principale, bouton DRILL relié à la navigation.
- app.js : application JavaScript, avec redirection de nav('drill') vers l'écran setup.
- style.css : styles de l'application.
- manifest.json : configuration PWA.
- service-worker.js : cache v13 pour déclencher la mise à jour.
- diagnostic.html : page de vérification et d'export JSON des données locales.

Installation :
1. Décompresse l'archive.
2. Remplace les fichiers correspondants dans le dépôt GitHub Pages.
3. Attends la fin du déploiement GitHub Pages.
4. Ferme complètement l'application installée sur le téléphone puis rouvre-la.

Important : ne supprime pas les données du navigateur et ne désinstalle pas l'application avant d'avoir exporté une sauvegarde si tes ranges sont importantes. Le fichier diagnostic.html peut exporter les données locales en JSON.


Correctifs supplémentaires (v13) :
- Matrice 13 x 13 : largeur complète, cases carrées et tailles de texte adaptées au téléphone.
- Le lancement du drill est bloqué tant qu’un nombre de mains n’a pas été explicitement choisi.
- Les boutons de réponse reprennent la couleur des étiquettes correspondantes.
