module.exports = require('machine').build({


  friendlyName: 'Find (records)',


  description: 'Find record(s) in the database.',


  inputs: {
    query: require('../constants/query.input'),
    connection: require('../constants/connection.input'),
    dryOrm: require('../constants/dry-orm.input'),
  },


  exits: {

    success: {
      outputFriendlyName: 'Records',
      outputDescription: 'An array of physical records.',
      outputExample: '===' //[ {===} ]
    },

  },


  fn: function select(inputs, exits) {
    // Dependencies
    var assert = require('assert');
    var _ = require('@sailshq/lodash');
    var processNativeRecord = require('./private/process-native-record');
    var reifyWhereClause = require('./private/reify-where-clause');


    // Local var for the stage 3 query, for easier access.
    var s3q = inputs.query;

    // Local var for the `tableName`, for clarity.
    var tableName = s3q.using;

    // Grab the model definition
    var WLModel = _.find(inputs.dryOrm.models, {tableName: tableName});
    if (!WLModel) {
      return exits.error(new Error('No model with that tableName (`'+tableName+'`) has been registered with this adapter.  Were any unexpected modifications made to the stage 3 query?  Could the adapter\'s internal state have been corrupted?  (This error is usually due to a bug in this adapter\'s implementation.)'));
    }//-•


    //  ┌┬┐┌─┐┌┐┌┌─┐┌─┐┬┌─┐┬ ┬  ╔═╗╦═╗╦╔╦╗╔═╗╦═╗╦╔═╗
    //  ││││ │││││ ┬│ ││├┤ └┬┘  ║  ╠╦╝║ ║ ║╣ ╠╦╝║╠═╣
    //  ┴ ┴└─┘┘└┘└─┘└─┘┴└   ┴   ╚═╝╩╚═╩ ╩ ╚═╝╩╚═╩╩ ╩

    // Create the initial Mongo query, taking care of `where`, `limit`, and `sort`.
    var db = inputs.connection;
    var mongoCollection = db.collection(tableName);

    // Build a Mongo-style WHERE from the `where` clause.
    var mongoWhere;
    try {
      mongoWhere = reifyWhereClause(s3q.criteria.where);
    } catch (e) { return exits.error(e); }


    // Transform the `sort` clause from a stage 3 query into a Mongo sort.
    var mongoSort = _.map(s3q.criteria.sort, function mapSort(s3qSortDirective) {

      var mongoSortDirective = [];

      var sortByKey = _.first(_.keys(s3qSortDirective));
      mongoSortDirective.push(sortByKey);

      var sortDirection = s3qSortDirective[sortByKey];
      assert(sortDirection === 'ASC' || sortDirection === 'DESC', new Error('Consistency violation: At this point, the sort direction should always be ASC or DESC (capitalized).  If you are seeing this message, there is probably a bug somewhere in your version of Waterline core.'));
      mongoSortDirective.push(sortDirection === 'ASC' ? 1 : -1);

      return mongoSortDirective;

    });

    var mongoDeferred;
    try {
      mongoDeferred = mongoCollection.find(mongoWhere).limit(s3q.criteria.limit).sort(mongoSort);
    } catch (err) { return exits.error(err); }

    // Add in `select` if necessary.
    // (note that `select` _could_ be undefined--i.e. when a model is `schema: false`)
    if (s3q.criteria.select) {

      // Transform the stage-3 query select array into a Mongo projection dictionary.
      var projection = _.reduce(s3q.criteria.select, function reduceProjection(memo, colName) {
        memo[colName] = 1;
        return memo;
      }, {});
      mongoDeferred = mongoDeferred.project(projection);
    }

    // Add in skip if necessary.
    // (if it is zero, no reason to mess with mixing it in at all)
    if (s3q.criteria.skip) {
      mongoDeferred.skip(s3q.criteria.skip);
    }


    //  ╔═╗╔═╗╔╦╗╔╦╗╦ ╦╔╗╔╦╔═╗╔═╗╔╦╗╔═╗  ┬ ┬┬┌┬┐┬ ┬  ┌┬┐┌┐
    //  ║  ║ ║║║║║║║║ ║║║║║║  ╠═╣ ║ ║╣   ││││ │ ├─┤   ││├┴┐
    //  ╚═╝╚═╝╩ ╩╩ ╩╚═╝╝╚╝╩╚═╝╩ ╩ ╩ ╚═╝  └┴┘┴ ┴ ┴ ┴  ─┴┘└─┘
    // Find the documents in the db.
    mongoDeferred.toArray(function findCb(err, nativeResult) {
      if (err) { return exits.error(err); }

      //  ╔═╗╦═╗╔═╗╔═╗╔═╗╔═╗╔═╗  ┌┐┌┌─┐┌┬┐┬┬  ┬┌─┐  ┬─┐┌─┐┌─┐┌─┐┬─┐┌┬┐┌─┌─┐─┐
      //  ╠═╝╠╦╝║ ║║  ║╣ ╚═╗╚═╗  │││├─┤ │ │└┐┌┘├┤   ├┬┘├┤ │  │ │├┬┘ │││ └─┐ │
      //  ╩  ╩╚═╚═╝╚═╝╚═╝╚═╝╚═╝  ┘└┘┴ ┴ ┴ ┴ └┘ └─┘  ┴└─└─┘└─┘└─┘┴└──┴┘└─└─┘─┘
      // Process records (mutate in-place) to wash away adapter-specific eccentricities.
      var phRecords = nativeResult;
      try {
        _.each(phRecords, function (phRecord){
          processNativeRecord(phRecord, WLModel);
        });
      } catch (e) { return exits.error(e); }

      return exits.success(phRecords);

    }); // </ mongoDeferred.toArray() >
  }
});