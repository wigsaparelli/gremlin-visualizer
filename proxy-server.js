const config = require('dotenv').config().parsed;
const express = require('express');
const bodyParser = require('body-parser');
const gremlin = require('gremlin');
const cors = require('cors');
const app = express();
const port = 3001;

const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(
    `/dbs/${config.database}/colls/${config.container}`, config.primaryKeyReadOnly
  );

const client = new gremlin.driver.Client(
    config.gremlinEndpoint,
    {
        authenticator,
        traversalsource : "g",
        rejectUnauthorized : true,
        mimeType : "application/vnd.gremlin-v2.0+json"
    }
);

app.use(cors({
  credentials: true,
}));

// parse application/json
app.use(bodyParser.json());

function mapProps(props, isEdge) {
  let obj = {};

  for (const key in props) {
    const val = props[key];
    obj[key] = Array.isArray(val) && val.length < 2 ? val[0] : val;
  }

  if (!isEdge) {
    if (obj.squp_type) {
        obj.squp_display = `${obj.sourceName} ${obj.squp_type}\n${obj.name}`;
    } else if (obj.squp_canonical_type) {
        obj.squp_display = `Canonical ${obj.squp_canonical_type}\n${obj.name}`;
    } else {
        obj.squp_display = obj.name;
    }
}

  return obj;
}

function mapEdges(edgeList) {
  return edgeList.map(
    edge => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      properties: mapProps(edge.properties, true)
    })
  );
}

function getNodeLabel(node) {
    const sourceName = node.properties.sourceName;
    if (sourceName && sourceName[0] === 'SCOM') {
        return 'SCOM node';
    } else if (sourceName && sourceName[0] === 'New Relic') {
        return 'New Relic node';
    } else {
        return 'Canonical node';
    }
}

function mapNodes(nodeList) {
  return nodeList.map(
    node => ({
      id: node.id,
      label: getNodeLabel(node),
      properties: mapProps(node.properties, false),
      edges: mapEdges(node.edges)
    })
  );
}

function makeQuery(query, nodeLimit) {
  const nodeLimitQuery = !isNaN(nodeLimit) && Number(nodeLimit) > 0 ? `.limit(${nodeLimit})`: '';
  return `${query}${nodeLimitQuery}.dedup().as('node').project('id', 'label', 'properties', 'edges').by(__.id()).by(__.label()).by(__.valueMap()).by(__.outE().project('id', 'from', 'to', 'label', 'properties').by(__.id()).by(__.select('node').id()).by(__.inV().id()).by(__.label()).by(__.valueMap()).fold())`;
}

app.post('/query', (req, res, next) => {
  const nodeLimit = req.body.nodeLimit;
  const query = req.body.query;

  client.submit(makeQuery(query, nodeLimit), {})
    .then((result) => res.send(mapNodes(result._items)))
    .catch((err) => next(err));
});

app.listen(port, () => console.log(`Simple gremlin-proxy server listening on port ${port}!`));