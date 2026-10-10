/**
 * Het Firebase-project waar sessie en logboek van een auto gedeeld worden (zie `design.md`, "Delen met
 * een partner"). Leeg = delen staat uit en de app raakt het netwerk hier niet aan.
 *
 * Dit zijn de gegevens van een *webapp*-registratie in de Firebase-console en ze zijn bedoeld om in een
 * publieke pagina te staan: de beveiliging zit in de Firestore-regels en in de HTTP-referrer-beperking
 * van de sleutel, niet in het geheimhouden ervan. Een token of service-account hoort hier nooit.
 */
export const FIREBASE = {
  projectId: "",
  apiKey: "",
};
