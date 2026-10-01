import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import Icon from '../components/Icon'
import { CoverageKey } from '../components/Legend'

export default function HelpPage() {
  return (
    <div className="admin-shell">
      <AppHeader
        subtitle="Aide"
        actions={
          <Link className="btn small" to="/">
            <Icon name="arrowLeft" size={16} />
            Retour à la carte
          </Link>
        }
      />

      <main className="help">
        <section>
          <h1>Utiliser la carte</h1>
          <p>
            La carte montre les secteurs des commerciaux du groupe, avec un onglet par structure (<strong>MD</strong> Maison
            Davoise, <strong>SP</strong> Splayce, <strong>MC</strong> MaucoCartex, <strong>BK</strong> BK Event…). L'onglet{' '}
            <em>Globale</em> réunit toutes les structures. Les admins ajoutent, renomment ou réordonnent les structures dans
            l'onglet <em>Structures</em> de l'admin.
          </p>
          <ul>
            <li>
              <strong>Vues</strong> : France (avec la Corse, les DROM et Monaco en encarts), Île-de-France, et Paris par
              arrondissement. Molette, pincement ou boutons + / − pour zoomer.
            </li>
            <li>
              <strong>Couleur</strong> : par commercial (par défaut), par Manager 1, par Manager 2, ou{' '}
              <strong>Couverture</strong> (carte de chaleur, voir plus bas).
            </li>
            <li>
              <strong>Survol</strong> d'une zone : nom, code et commerciaux présents. <strong>Clic</strong> : détail dans le
              panneau de droite.
            </li>
            <li>
              <strong>Légende</strong> : un clic sur un nom met ses zones en évidence. Plusieurs noms peuvent être
              sélectionnés. Les postes « À recruter » sont regroupés à part, en fin de liste, avec leur couleur.
            </li>
            <li>
              <strong>Filtres</strong> : manager, commercial, couverture, statut (dont « masquer les À recruter »).
            </li>
            <li>
              <strong>Export PNG</strong> : image de la vue actuelle, avec sa légende (dont la section « À recruter »).
            </li>
            <li>
              L'adresse de la page garde l'onglet, la vue et le mode de couleur : on peut la copier pour partager une vue
              précise (le code reste demandé).
            </li>
          </ul>
        </section>

        <section>
          <h2>Lire les couleurs</h2>
          <CoverageKey />
          <ul>
            <li>
              <strong>Propre</strong> : remplissage plein.
            </li>
            <li>
              <strong>Partiel</strong> : remplissage atténué.
            </li>
            <li>
              <strong>Gestion</strong> : trame de points.
            </li>
            <li>
              <strong>Zone partagée</strong> par plusieurs commerciaux (ou managers), au choix dans la légende :{' '}
              <em>Rayures</em> aux couleurs de chacun ; <em>Découpage</em>, une bande verticale par commercial ;{' '}
              <em>Camemberts</em>, la zone garde une teinte légère et un petit camembert montre qui la partage ;{' '}
              <em>Dominante</em>, la couleur du principal (propre avant partiel avant gestion) avec un badge « +2 » pour
              les autres. Le mode proposé à l'ouverture se règle dans l'admin (Paramètres).
            </li>
            <li>
              À Paris, « 75 » saisi seul couvre les 20 arrondissements ; un arrondissement se saisit <code>75-7</code>.
            </li>
          </ul>
        </section>

        <section>
          <h2>Vue « Couverture »</h2>
          <p>
            Dans <strong>Couleur → Couverture</strong>, chaque zone est colorée selon un score : chaque commercial présent
            compte <strong>1</strong> en propre, <strong>½</strong> en partiel et <strong>¼</strong> en gestion. Les
            filtres et l'onglet s'appliquent (par exemple : la couverture MD seule).
          </p>
          <ul>
            <li>Gris : non couverte · bleu très clair : faible (gestion ou partiel seulement)</li>
            <li>Bleu azurin : couverte (≈ 1 commercial) · bleu moyen : renforcée (≈ 2) · bleu saphir : forte (3 ou plus)</li>
            <li>Un clic sur un niveau de la légende isole ses zones, pratique pour repérer les zones non couvertes.</li>
          </ul>
        </section>

        <section>
          <h2>CA et objectifs (admins)</h2>
          <p>
            Le CA et l'objectif de chaque commercial se saisissent par structure et par année, dans son panneau (onglet{' '}
            <em>Commerciaux</em> de l'admin ; raccourcis <code>120k</code> et <code>1,2M</code> acceptés), ou par l'import Excel
            (colonnes <code>CA MD</code>, <code>Objectif MD</code>…).
            Ils ne sont <strong>jamais visibles avec le seul code d'accès</strong> : il faut être connecté en admin.
          </p>
          <ul>
            <li>
              Sur la carte, un sélecteur <strong>CA</strong> choisit l'année ; la légende montre le CA, l'objectif et le taux
              atteint de chaque commercial (ou de l'équipe d'un manager).
            </li>
            <li>
              <strong>Couleur → Performance</strong> colore chaque zone selon le taux d'atteinte cumulé de ses commerciaux,
              du rouge (moins de 50 %) au vert (120 % et plus), avec un classement des commerciaux.
            </li>
            <li>
              L'onglet <strong>Synthèse</strong> de l'admin totalise par commercial, manager ou structure, avec export Excel.
            </li>
          </ul>
        </section>

        <section>
          <h2>Saisir les zones (admin et fichier Excel)</h2>
          <table>
            <tbody>
              <tr>
                <th>Saisie</th>
                <th>Signification</th>
              </tr>
              <tr>
                <td><code>22, 35P, 52G</code></td>
                <td>22 propre, 35 partiel, 52 gestion</td>
              </tr>
              <tr>
                <td><code>9</code></td>
                <td>09 (un code à un chiffre est complété par un 0)</td>
              </tr>
              <tr>
                <td><code>20</code> ou <code>2AB</code></td>
                <td>2A et 2B</td>
              </tr>
              <tr>
                <td><code>75</code></td>
                <td>tout Paris</td>
              </tr>
              <tr>
                <td><code>75-7</code></td>
                <td>Paris 7e (<code>75007</code> est aussi accepté)</td>
              </tr>
              <tr>
                <td><code>971 … 976</code>, <code>98</code></td>
                <td>DROM, Monaco</td>
              </tr>
              <tr>
                <td><code>?</code></td>
                <td>ignoré</td>
              </tr>
            </tbody>
          </table>
          <p>
            Séparateurs acceptés : virgule, point, barre oblique, point-virgule et espace. Toute valeur inconnue est signalée
            avant l'enregistrement.
          </p>
        </section>

        <section>
          <h2>Import Excel</h2>
          <p>
            Onglet <code>V3</code> par défaut, en-têtes en ligne 3. Les colonnes sont reconnues par leur nom :{' '}
            <code>Nom</code>, une colonne par structure (<code>MD</code>, <code>SP</code>… : « X » = appartient à la
            structure), <code>Statut</code>, <code>Manager 1</code>, <code>Manager 2</code>, <code>DPT MD</code>,{' '}
            <code>DPT SP</code>…, et en option <code>Nb de jour / an</code>, <code>Date 1</code>, <code>Date 2</code>,{' '}
            <code>Actions</code>, <code>Région</code>, <code>CA MD</code>, <code>Objectif MD</code>… Une ligne sans nom est
            ignorée. Pour une nouvelle structure, créez-la d'abord dans l'admin (onglet <em>Structures</em>) : ses colonnes
            sont ensuite lues à l'import et ajoutées à l'export.
          </p>
          <ul>
            <li>
              <strong>Fusionner</strong> : ajoute les nouveaux commerciaux et met à jour ceux du fichier ; les autres ne
              bougent pas.
            </li>
            <li>
              <strong>Remplacer tout</strong> : le fichier devient la référence ; les commerciaux absents du fichier sont
              supprimés.
            </li>
          </ul>
          <p>
            Les commerciaux sont reconnus par leur nom (sans tenir compte des majuscules ni des accents). Leur couleur et
            leurs notes sont conservées.
          </p>
        </section>
      </main>
    </div>
  )
}
