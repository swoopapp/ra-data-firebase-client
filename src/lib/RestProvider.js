import firebase from 'firebase';
import Methods from './methods';

import { GET_LIST, GET_ONE, GET_MANY, GET_MANY_REFERENCE, CREATE, UPDATE, DELETE, DELETE_MANY } from 'react-admin';

/**
 * @param {string[]|Object[]} trackedResources Array of resource names or array of Objects containing name and
 * optional path properties (path defaults to name)
 * @param {Object} firebaseConfig Options Firebase configuration
 */

const affiliateToken = localStorage.getItem('Affiliate');

const BaseConfiguration = {
  initialQuerytimeout: 10000,
  timestampFieldNames: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  }
};

const RestProvider = (firebaseConfig = {}, options = {}) => {
  options = Object.assign({}, BaseConfiguration, options);
  const { timestampFieldNames, trackedResources, initialQuerytimeout } = options;

  const resourcesStatus = {};
  const resourcesReferences = {};
  const resourcesData = {};
  const resourcesPaths = {};
  const resourcesUploadFields = {};

  if (firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION);
  }

  /* Functions */
  const upload = options.upload || Methods.upload;
  const save = options.save || Methods.save;
  const del = options.del || Methods.del;
  const getItemID = options.getItemID || Methods.getItemID;
  const getOne = options.getOne || Methods.getOne;
  const getMany = options.getMany || Methods.getMany;
  const delMany = options.delMany || Methods.delMany;
  const getList = options.getList || Methods.getList;

  const firebaseSaveFilter = options.firebaseSaveFilter ? options.firebaseSaveFilter : data => data;
  const firebaseGetFilter = options.firebaseGetFilter ? options.firebaseGetFilter : data => data;

  // Sanitize Resources
  trackedResources.map((resource, index) => {
    if (typeof resource === 'string') {
      resource = {
        name: resource,
        path: resource,
        uploadFields: []
      };
      trackedResources[index] = resource;
    }

    const { name, path, uploadFields } = resource;
    if (!resource.name) {
      throw new Error(`name is missing from resource ${resource}`);
    }
    resourcesUploadFields[name] = uploadFields || [];
    resourcesPaths[name] = path || name;
    resourcesData[name] = {};
  });

  const initializeResource = ({ name, isPublic }, resolve) => {
    let ref = (resourcesReferences[name] = firebase.database().ref(resourcesPaths[name]));
    resourcesData[name] = [];

    if (isPublic) {
      subscribeResource(ref, name, resolve);
    } else {
      firebase.auth().onAuthStateChanged(auth => {
        if (auth) {
          subscribeResource(ref, name, resolve);
        }
      });
    }

    setTimeout(resolve, initialQuerytimeout);

    return true;
  };

  const subscribeResource = (ref, name, resolve) => {
    ref.orderByChild("affiliate").equalTo(affiliateToken).once('value', function(childSnapshot) {
      /** Uses "value" to fetch initial data. Avoid the RA to show no results */
      if (childSnapshot.key === name) {
        const entries = childSnapshot.val() || {};
        Object.keys(entries).map(key => {
          resourcesData[name][key] = firebaseGetFilter(entries[key], name);
        });
        Object.keys(resourcesData[name]).forEach(itemKey => {
          resourcesData[name][itemKey].id = itemKey;
          resourcesData[name][itemKey].key = itemKey;
        });
        resolve();
      }
    });
    ref.orderByChild("affiliate").equalTo(affiliateToken).on('child_added', function(childSnapshot) {
      resourcesData[name][childSnapshot.key] = firebaseGetFilter(
        Object.assign(
          {},
          {
            id: childSnapshot.key,
            key: childSnapshot.key
          },
          childSnapshot.val()
        ),
        name
      );
    });

    ref.on('child_removed', function(oldChildSnapshot) {
      if (resourcesData[name][oldChildSnapshot.key]) {
        delete resourcesData[name][oldChildSnapshot.key];
      }
    });

    ref.on('child_changed', function(childSnapshot) {
      resourcesData[name][childSnapshot.key] = childSnapshot.val();
    });
  };

  trackedResources.map(resource => {
    resourcesStatus[resource.name] = new Promise(resolve => {
      initializeResource(resource, resolve);
    });
  });

  /**
   * @param {string} type Request type, e.g GET_LIST
   * @param {string} resourceName Resource name, e.g. "posts"
   * @param {Object} payload Request parameters. Depends on the request type
   * @returns {Promise} the Promise for a REST response
   */

  return async (type, resourceName, params) => {
    await resourcesStatus[resourceName];
    let result = null;
    switch (type) {
      case GET_LIST:
        // console.log('GET_LIST');
        result = await getList(params, resourceName, resourcesData[resourceName]);
        return result;
      case GET_MANY:
        result = await getMany(params, resourceName, resourcesData[resourceName]);
        // console.log('GET_MANY');
        console.log('reselut', result);
        return result;

      case GET_MANY_REFERENCE:
        // console.log('GET_MANY_REFERENCE');
        result = await getMany(params, resourceName, resourcesData[resourceName]);
        return result;

      case GET_ONE:
        // console.log('GET_ONE');
        result = await getOne(params, resourceName, resourcesData[resourceName]);
        return result;

      case DELETE:
        // console.log('DELETE');
        const uploadFields = resourcesUploadFields[resourceName] ? resourcesUploadFields[resourceName] : [];
        result = await del(params.id, resourceName, resourcesPaths[resourceName], uploadFields);
        return result;

      case DELETE_MANY:
        // console.log('DELETE_MANY');
        result = await delMany(params.ids, resourceName, resourcesData[resourceName]);
        return result;
      case UPDATE:
      case CREATE:
        console.log('UPDATE/CREATE');
        let itemId = getItemID(params, type, resourceName, resourcesPaths[resourceName], resourcesData[resourceName]);
        const uploads = resourcesUploadFields[resourceName]
          ? resourcesUploadFields[resourceName].map(field =>
              upload(field, params.data, itemId, resourceName, resourcesPaths[resourceName])
            )
          : [];
        const currentData = resourcesData[resourceName][itemId] || {};
        const uploadResults = await Promise.all(uploads);

        result = await save(
          itemId,
          params.data,
          currentData,
          resourceName,
          resourcesPaths[resourceName],
          firebaseSaveFilter,
          uploadResults,
          type === CREATE,
          timestampFieldNames
        );
        return result;

      default:
        console.error('Undocumented method: ', type);
        return { data: [] };
    }
  };
};

export default RestProvider;
