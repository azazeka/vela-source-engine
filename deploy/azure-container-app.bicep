@description('Location for all resources')
param location string = resourceGroup().location

@description('Name of the Container App')
param appName string = 'vela-source-engine'

@description('Container image tag (e.g. vela-backend:latest or ACR image)')
param containerImage string

@description('TorBox API Key secret or setting')
@secure()
param torboxApiKey string = ''

@description('Torznab API endpoint, usually ending in /api')
param torznabUrl string = ''

@description('Torznab indexer API key')
@secure()
param torznabApiKey string = ''

@description('Optional comma-separated Torznab category IDs')
param torznabCategories string = ''

@description('Optional JSON array of Torznab indexers. Keep API keys in this secure parameter.')
@secure()
param torznabIndexersJson string = ''

@description('Target port exposed by the Express container')
param targetPort int = 3000

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'log-${appName}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource containerAppEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: 'cae-${appName}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'torbox-api-key'
          value: torboxApiKey
        }
        {
          name: 'torznab-api-key'
          value: torznabApiKey
        }
        {
          name: 'torznab-indexers-json'
          value: torznabIndexersJson
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            {
              name: 'PORT'
              value: string(targetPort)
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'TORBOX_API_KEY'
              secretRef: 'torbox-api-key'
            }
            {
              name: 'TORZNAB_URL'
              value: torznabUrl
            }
            {
              name: 'TORZNAB_API_KEY'
              secretRef: 'torznab-api-key'
            }
            {
              name: 'TORZNAB_CATEGORIES'
              value: torznabCategories
            }
            {
              name: 'TORZNAB_INDEXERS_JSON'
              secretRef: 'torznab-indexers-json'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: targetPort
              }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: targetPort
              }
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
output healthUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}/health'
