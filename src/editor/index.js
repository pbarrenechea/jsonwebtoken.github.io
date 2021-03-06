import { 
  deferToNextLoop,
  safeLocalStorageSetItem,
  copyTokenLink 
} from '../utils.js';
import { downloadPublicKeyIfPossible } from './public-key-download.js';
import { setupClaimsTooltip } from './claims-tooltip.js';
import { tokenEditor, headerEditor, payloadEditor } from './instances.js';
import { 
  getTrimmedValue,
  stringify,
  fixEditorHeight,
  getSelectedAlgorithm
} from './utils.js';
import { sign, verify, decode } from './jwt.js';
import EventManager from './event-manager.js';
import strings from '../strings.js';
import defaultTokens from './default-tokens.js';
import { 
  minSecretLengthCheck,
  setupSecretLengthTooltip 
} from './secret-length-tooltip.js';
import { 
  algorithmSelect, 
  signatureStatusElement,
  editorElement,
  headerElement,
  payloadElement,
  decodedElement,
  secretInput,
  privateKeyTextArea,
  publicKeyTextArea,
  hmacShaTextSpan,
  rsaShaTextSpan,
  keyEditorContainer,
  secretEditorContainer,
  secretBase64Checkbox,
  encodedTabLink,
  decodedTabLink,
  encodedTabElement,
  decodedTabElement
} from '../dom-elements.js';

import log from 'loglevel';

// The event manager lets us enable/disable events as needed without
// manually tracking them. Events that need to be disabled should be
// passed to the event manager.
const eventManager = new EventManager();

function isSharedSecretAlgorithm(algorithm) {
  return algorithm && algorithm.indexOf('HS') === 0;
}

function isPublicKeyAlgorithm(algorithm) {
  return algorithm && algorithm.indexOf('HS') === -1;
}

function markAsInvalid() {
  signatureStatusElement.classList.remove('valid-token');
  signatureStatusElement.classList.add('invalid-token');
  signatureStatusElement.innerHTML = 
    `<i class="icon-budicon-501"></i> ${strings.editor.signatureInvalid}`;
}

function markAsValid() {
  const elementsWithError = document.getElementsByClassName('error');
  Array.prototype.forEach.call(elementsWithError, element => {
    element.classList.remove('error');
  });

  signatureStatusElement.classList.remove('invalid-token');
  signatureStatusElement.classList.add('valid-token');
  signatureStatusElement.innerHTML = 
    `<i class="icon-budicon-499"></i> ${strings.editor.signatureVerified}`;
}

function displaySecretOrKeys(algorithm) {
  const algoType = algorithm.substr(0, 2);
  const algoSize = algorithm.substr(2, 3);

  if(algoType === 'HS') {
    hmacShaTextSpan.firstChild.textContent = `HMACSHA${algoSize}`;
    secretEditorContainer.style.display = '';
    keyEditorContainer.style.display = 'none';
  } else {
    const texts = {
      RS: 'RSASHA',
      PS: 'RSAPSSSHA',
      ES: 'ECDSASHA'
    };

    rsaShaTextSpan.firstChild.textContent = `${texts[algoType]}${algoSize}`;
    secretEditorContainer.style.display = 'none';
    keyEditorContainer.style.display = '';
  }

  deferToNextLoop(fixEditorHeight);
}

function selectAlgorithm(algorithm) {
  eventManager.withDisabledEvents(() => {
    const selected = 
      algorithmSelect.querySelector(`option[value="${algorithm}"]`);
    
    if(!selected) {
      log.info(`Invalid algorithm ${algorithm}, ignoring...`);
      return;
    }

    selected.selected = true;

    displaySecretOrKeys(algorithm);    
  });
}

function isDefaultToken(token) {
  for(const algorithm of Object.keys(defaultTokens)) {
    if(defaultTokens[algorithm].token === token) {
      return true;
    }
  }

  return false;
}

export function useDefaultToken(algorithm) {
  eventManager.withDisabledEvents(() => {
    const defaults = defaultTokens[algorithm.toLowerCase()];
    const decoded = decode(defaults.token);

    tokenEditor.setValue(defaults.token);    
    headerEditor.setValue(stringify(decoded.header));
    payloadEditor.setValue(stringify(decoded.payload));
    
    if(isSharedSecretAlgorithm(algorithm)) {
      secretInput.value = defaults.secret;
    } else {
      publicKeyTextArea.value = defaults.publicKey;
      privateKeyTextArea.value = defaults.privateKey;
    }

    markAsValid();
  });
}

function setAlgorithmInHeader(algorithm) {
  eventManager.withDisabledEvents(() => {
    try {
      const header = JSON.parse(headerEditor.getValue());
      header.alg = algorithm;
      headerEditor.setValue(stringify(header));
    } catch(e) {
      // SyntaxError is expected while things are being edited, ignore those
      // errors.
      if(!(e instanceof SyntaxError)) {
        // If it's not a SyntaxError, log the error.
        log.warn('Failed to encode token: ', e);
      }
    }

    try {
      encodeToken();
    } catch(e) {
      // Ignore error, this may fail in unexpected ways if the data
      // is being edited.
    }
  });
}

function algorithmChangeHandler() {
  const algorithm = getSelectedAlgorithm();
  
  displaySecretOrKeys(algorithm);

  if(isDefaultToken(getTrimmedValue(tokenEditor))) {
    useDefaultToken(algorithm);
  } else {
    setAlgorithmInHeader(algorithm);
  }
}

function markAsInvalidWithElement(element, clearTokenEditor = true) {
  element.classList.add('error');
  markAsInvalid();
  
  if(clearTokenEditor) {
    eventManager.withDisabledEvents(() => { 
      tokenEditor.setValue(''); 
    });
  }
}

function saveAsLastToken() {
  const token = getTrimmedValue(tokenEditor);
  if(token && token.length > 0) {
    safeLocalStorageSetItem('lastToken', token);
  }

  const publicKey = publicKeyTextArea.value;
  if(publicKey && publicKey.length > 0) {
    safeLocalStorageSetItem('lastPublicKey', publicKey);
  }
}

function loadToken() {
  const lastToken = localStorage.getItem('lastToken');

  if(lastToken) {
    setTokenEditorValue(lastToken);
    
    const lastPublicKey = localStorage.getItem('lastPublicKey');
    if(lastPublicKey) {
      publicKeyTextArea.value = lastPublicKey;
    }
  } else {
    useDefaultToken('HS256');
  }
}

function encodeToken() {
  deferToNextLoop(fixEditorHeight);

  eventManager.withDisabledEvents(() => {
    let header;
    try {
      header = JSON.parse(headerEditor.getValue());
    } catch(e) {
      markAsInvalidWithElement(headerElement, true);
      return;
    }

    if(!header.alg) {
      setAlgorithmInHeader(getSelectedAlgorithm());
      return;
    } else {
      selectAlgorithm(header.alg);
    }

    let payload;
    try {
      payload = JSON.parse(payloadEditor.getValue());
    } catch(e) {
      markAsInvalidWithElement(payloadElement, true);
      return;
    }

    try {
      const encoded = sign(header, payload, 
        isSharedSecretAlgorithm(header.alg) ?
          secretInput.value :
          privateKeyTextArea.value,
          secretBase64Checkbox.checked);
          
      tokenEditor.setValue(encoded);

      saveAsLastToken();
    } catch(e) {
      log.warn('Failed to sign/encode token: ', e);      
      markAsInvalid();
      tokenEditor.setValue('');
    }    

    verifyToken();
  });
}

function decodeToken() {
  deferToNextLoop(fixEditorHeight);

  eventManager.withDisabledEvents(() => {
    try {
      const jwt = getTrimmedValue(tokenEditor);
      const decoded = decode(jwt);
  
      selectAlgorithm(decoded.header.alg);
      if(isPublicKeyAlgorithm(decoded.header.alg)) {
        downloadPublicKeyIfPossible(decoded).then(publicKey => {
          eventManager.withDisabledEvents(() => {
            publicKeyTextArea.value = publicKey;
            verifyToken();
          });
        });
      }
  
      headerEditor.setValue(stringify(decoded.header));
      payloadEditor.setValue(stringify(decoded.payload));
  
      if(decoded.errors) {
        markAsInvalidWithElement(editorElement, false);
      } else {
        saveAsLastToken();
        verifyToken();
      }
    } catch(e) {
      log.warn('Failed to decode token: ', e);
    }  
  });
}

function verifyToken() {
  const jwt = getTrimmedValue(tokenEditor);
  const decoded = decode(jwt);
  
  if(!decoded.header.alg || decoded.header.alg === 'none') {
    markAsInvalid();
    return;
  }

  const publicKeyOrSecret = 
    isSharedSecretAlgorithm(decoded.header.alg) ?
      secretInput.value : 
      publicKeyTextArea.value;

  if(verify(jwt, publicKeyOrSecret, secretBase64Checkbox.checked)) {
    markAsValid();
  } else {
    markAsInvalid();
  }
}

function setupTabEvents() {
  // These are relevant for portrait or mobile screens.
  
  encodedTabLink.addEventListener('click', event => {
    event.preventDefault();

    decodedTabLink.parentNode.classList.remove('current');
    encodedTabLink.parentNode.classList.add('current');
    decodedTabElement.classList.remove('current');
    encodedTabElement.classList.add('current');
  });

  decodedTabLink.addEventListener('click', event => {
    event.preventDefault();

    encodedTabLink.parentNode.classList.remove('current');
    decodedTabLink.parentNode.classList.add('current');
    encodedTabElement.classList.remove('current');
    decodedTabElement.classList.add('current');
  });
}

function setupEvents() {
  // The event manager lets us enable/disable events as needed without
  // manually tracking them. Events that need to be disabled should be
  // passed to the event manager.

  eventManager.addDomEvent(algorithmSelect, 'change', algorithmChangeHandler);

  // When an encoded token is inserted, it must be decoded.
  eventManager.addCodeMirrorEvent(tokenEditor, 'change', decodeToken);
  // When parts of the decoded token are changed, it must be reencoded.
  eventManager.addCodeMirrorEvent(headerEditor, 'change', encodeToken);
  eventManager.addCodeMirrorEvent(payloadEditor, 'change', encodeToken);

  // HMAC secret, show tooltip if secret is too short.
  eventManager.addDomEvent(secretInput, 'input', minSecretLengthCheck);
  // HMAC secret, when changed the encoded token must be updated.
  eventManager.addDomEvent(secretInput, 'input', encodeToken);  
  // Base64 checkbox, when changes the encoded token must be updated.
  eventManager.addDomEvent(secretBase64Checkbox, 'change', encodeToken);
  // Private key, when changed the encoded token must be updated.
  eventManager.addDomEvent(privateKeyTextArea, 'input', encodeToken);
  // Public key, when changed the encoded token must NOT be updated
  // (only verified).
  eventManager.addDomEvent(publicKeyTextArea, 'input', verifyToken);

  // The following events are never disabled, so it is not necessary to go
  // through the event manager for them.
  setupTabEvents();
}

export function setTokenEditorValue(value) {
  tokenEditor.setValue(value);
}

export function getTokenEditorValue() {
  return {
    token: getTrimmedValue(tokenEditor),
    publicKey: isPublicKeyAlgorithm(getSelectedAlgorithm()) ? 
      publicKeyTextArea.value :
      undefined
  };
}

export function setupTokenEditor() {
  setupEvents();
  selectAlgorithm('HS256');
  loadToken();
  fixEditorHeight();
  setupSecretLengthTooltip();
  setupClaimsTooltip();
}
