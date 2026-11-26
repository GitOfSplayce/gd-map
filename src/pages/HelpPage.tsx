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
              <strong>Couleur</strong> : par commercial (par défaut), par manager (Manager 1 et Manager 2, selon ceux que les admins ont
              activés), ou <strong>Couverture</strong> (carte de chaleur, voir plus bas).
            </li>
            <li>
              <strong>Survol</strong> d'une zone : nom, code et commerciaux présents. <strong>Clic</strong> : détail dans le
              panneau de droite, avec le téléphone et l'e-mail de chaque commercial et de ses managers (un clic pour appeler
              ou écrire).
            </li>
            <li>
              <strong>Légende</strong> : un clic sur un nom met ses zones en évidence. Plusieurs noms peuvent être
              sélectionnés. Les départements à recruter sont regroupés à part, en fin de liste, par groupe ou par priorité.
            </li>
            <li>
              <strong>Filtres</strong> : manager, commercial, couverture, statut, et « masquer les départements à recruter ».
            </li>
            <li>
              <strong>Export PNG</strong> : image de la vue actuelle, avec sa légende (motifs présents, personnes,
              départements à recruter). En option, les départements de chacun sous son nom : <strong>22, 35P, 52G</strong>{' '}
              (P : partiel, G : gestion, GP : gestion-partiel, sans lettre : propre). Après un zoom, la légende ne garde que
              ce qui se voit.
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
              <strong>Partiel</strong> (P) : un partiel n'est jamais seul sur sa zone, il s'affiche donc comme une zone
              partagée. Seul, sa deuxième couleur est le <strong>blanc</strong> (« personne d'autre ») ; avec un autre
              commercial, ils se partagent la zone sans blanc.
            </li>
            <li>
              <strong>Gestion</strong> (G) : trame de points ; dans une zone partagée, sa part est en points.
            </li>
            <li>
              <strong>Gestion-partiel</strong> (GP) : traits en pointillés, avec du blanc s'il est seul sur sa zone.
            </li>
            <li>
              <strong>Zone partagée</strong> par plusieurs commerciaux (ou managers), au choix dans la légende :{' '}
              <em>Rayures</em> aux couleurs de chacun ; <em>Découpage</em>, une bande verticale par commercial ;{' '}
              <em>Camemberts</em>, la zone garde une teinte légère et un petit camembert montre qui la partage ;{' '}
              <em>Dominante</em>, la couleur du principal (propre, puis partiel, gestion, gestion-partiel) avec un badge
              « +2 » pour les autres ; un partiel seul reste rayé avec le blanc. Le mode proposé à l'ouverture se règle
              dans l'admin (Paramètres).
            </li>
            <li>
              À Paris, « 75 » saisi seul couvre les 20 arrondissements ; un arrondissement se saisit <code>75-7</code>.
            </li>
          </ul>
        </section>

        <section>
          <h2>Départements à recruter</h2>
          <p>
            Un département <strong>vide</strong> dans une structure est <strong>à recruter</strong>. Les admins lui donnent une{' '}
            <strong>priorité</strong> de 1 à 3, qui le raye de sa couleur sur la carte, et un <strong>groupe</strong>, qui réunit les
            départements d'un même poste : il est entouré et nommé sur la carte. Dans un groupe sans priorité, il est rayé de gris ; vide
            sans rien de décidé, il reste gris uni.
          </p>
          <ul>
            <li>
              Un département <strong>déjà occupé</strong> peut être à recruter aussi : pour un second commercial, ou un commercial en
              propre là où il n'y a que de la gestion ou du partiel. Il garde la couleur de son commercial, les rayures passent par-dessus.
            </li>
            <li>
              Il sort du recrutement dès qu'un commercial y arrive <strong>en propre</strong> ; en gestion ou en partiel, il y reste.
            </li>
            <li>
              Un groupe s'attribue d'un coup : « Ajouter un groupe » dans la fiche d'un commercial, ou « Attribuer à… » sur le groupe, dans
              l'onglet <em>Recrutement</em>.
            </li>
            <li>L'onglet d'une structure montre ce que cette structure a à recruter.</li>
            <li>
              Sur l'onglet <em>Globale</em>, un département vide n'est à recruter que si aucune structure n'y a quelqu'un ; un département
              marqué se voit toujours. Son détail dit quelles structures recrutent.
            </li>
          </ul>
        </section>

        <section>
          <h2>Vue « Couverture »</h2>
          <p>
            Dans <strong>Couleur → Couverture</strong>, chaque zone est colorée selon un score : chaque commercial présent
            compte <strong>1</strong> en propre, <strong>½</strong> en partiel, <strong>¼</strong> en gestion et{' '}
            <strong>⅛</strong> en gestion-partiel. Les filtres et l'onglet s'appliquent (par exemple : la couverture MD
            seule).
          </p>
          <ul>
            <li>Gris : non couverte · bleu très clair : faible (gestion ou partiel seulement)</li>
            <li>Bleu azurin : couverte (≈ 1 commercial) · bleu moyen : renforcée (≈ 2) · bleu saphir : forte (3 ou plus)</li>
            <li>Un clic sur un niveau de la légende isole ses zones, pratique pour repérer les zones non couvertes.</li>
          </ul>
        </section>

        <section>
          <h2>CA et objectifs (admins et managers)</h2>
          <p>
            Le CA et l'objectif de chaque commercial se saisissent par structure et par année (raccourcis <code>120k</code> et{' '}
            <code>1,2M</code> acceptés). Ils ne sont <strong>jamais visibles avec le seul code d'accès</strong> : il faut être connecté en
            admin ou en manager.
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
          <h2>Saisir les départements</h2>
          <table>
            <tbody>
              <tr>
                <th>Saisie</th>
                <th>Signification</th>
              </tr>
              <tr>
                <td><code>22, 35P, 52G, 54GP</code></td>
                <td>22 propre, 35 partiel, 52 gestion, 54 gestion-partiel (PG est aussi accepté)</td>
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
            L'<em>Assistant</em> les choisit sur une carte : un clic en pose un, rester appuyé en peint plusieurs (appui long au doigt).
            Séparateurs acceptés en texte : virgule, point, barre oblique, point-virgule et espace. Toute valeur inconnue est signalée
            avant l'enregistrement.
          </p>
        </section>

        <section>
          <h2>Espace manager</h2>
          <p>
            Un manager relié à son compte GD One ouvre la carte sans code. Il y voit tout, chiffres compris, et modifie seulement les{' '}
            <strong>départements</strong>, le <strong>CA</strong> et les <strong>objectifs</strong> de ses commerciaux, dans ses structures :
          </p>
          <ul>
            <li>
              dans <em>Mon équipe</em>, ou depuis la carte en cliquant sur un département (<em>Placer un de mes commerciaux</em>) ;
            </li>
            <li>
              un département, dans une structure, est à un seul manager, quel que soit le type (propre, partiel, gestion). Il peut le partager
              entre plusieurs de ses commerciaux ; celui d'un autre manager ne se prend pas. Un admin n'a pas cette limite ;
            </li>
            <li>
              un manager qui a aussi sa propre fiche de commercial la modifie ; ses départements prennent la couleur de son équipe en vue
              Manager, et son CA compte avec elle ;
            </li>
            <li>tout changement se voit aussitôt sur la carte, et le journal garde qui a modifié quoi.</li>
          </ul>
        </section>

        <section>
          <h2>Admin : export Excel et journal</h2>
          <p>
            La carte est la source des données. L'onglet <em>Export</em> en fait un classeur mis en forme : commerciaux, départements (dont
            ceux à recruter), CA et objectifs, managers. Le <em>Journal</em> garde chaque modification, avant et après.
          </p>
        </section>
      </main>
    </div>
  )
}
