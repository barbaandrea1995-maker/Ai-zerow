# Ruoli e capability — Commercial v1

## Principio

L'accesso e `deny by default`. Il browser non assegna tenant, ruolo o capability. Il server deriva membership e tenant, filtra navigazione e widget, protegge la route e ripete il controllo nell'API.

Nelle superfici protette la sessione Neon autenticata e l'identita primaria anche per l'autorita D1. L'identita Sites resta un fallback controllato e il solo bootstrap iniziale; non puo sovrascrivere il ruolo della sessione applicativa.

## Ruoli canonici

| Ruolo | Perimetro principale | Command | Scritture principali |
|---|---|---:|---|
| Owner | Proprieta tenant e controllo completo | Si | Tenant, Authority e tutti i domini |
| Amministratore | Amministrazione operativa | Si | Authority e domini, esclusa proprieta tenant |
| Collaboratore | Operativita trasversale di base | Si | Field e dati del proprio perimetro |
| Manager | Coordinamento operativo/economico | Si | Commesse, planning, risorse, approvazioni |
| Ufficio | Back office e documentale | Si | Commesse, documenti, planning, finance/procurement |
| Tecnico | Progettazione ed esecuzione tecnica | Si | Lavori, field, asset e documenti |
| Caposquadra | Coordinamento sul campo | Si | Field e workforce assegnata |
| Operatore | Esecuzione assegnata | No | Field e registrazioni consentite |
| Responsabile magazzino | Deposito, scorte e missioni | Si | Magazzino e missioni |
| Operatore magazzino | Movimenti materiali | No | Magazzino nel proprio perimetro |
| Autista | Trasporti assegnati | No | Missioni e POD autorizzati |
| Manutentore | Manutenzione asset | No | Asset ed evidenze tecniche |
| Auditor | Controllo trasversale | Si, sola lettura | Nessuna write operativa |

## Separazioni sensibili

- `tenant.manage`: solo Owner;
- `authority.manage` e `onboarding.manage`: Owner e Amministratore;
- `authority.read`: Owner, Amministratore, Manager, Ufficio e Auditor;
- `command.customize`: solo ruoli operativi con Command; Auditor escluso;
- `events.write`: Owner, Amministratore e Manager;
- finance non e ereditata da Warehouse, Driver, Worker o Maintenance;
- un widget viene restituito dal catalogo soltanto se tutte le capability richieste sono presenti;
- layout manomessi, widget sconosciuti, duplicati o dimensioni invalide vengono sanificati dal server.

## Onboarding in sei gate

1. Identita provider e membership tenant.
2. Azienda, sedi e contesto operativo.
3. Ruoli canonici e profili accesso.
4. Moduli visibili e scope delle risorse.
5. Company AI, approval e no-direct-write policy.
6. Verifica negativa, audit e certificazione release.

Invite, suspend/remove, session invalidation e review periodica degli accessi rimangono gate obbligatori prima della GA.

## Evidenza dinamica RC1

- un'identita Sites non censita riceve `401` dopo il provisioning del tenant canonico;
- Worker riceve `403` su dashboard Command e preferenze;
- Auditor legge Command ma non puo salvare il layout (`403`);
- Owner legge e salva il layout; input manipolati vengono sanificati lato server;
- l'Owner del tenant A non puo selezionare il tenant B (`403`);
- l'Owner del tenant B riceve una directory composta dal solo tenant B.
